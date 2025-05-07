const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();

// Firebase Cloud Function to send FCM notifications
exports.sendNotification = functions.https.onRequest(async (req, res) => {
  // Set CORS headers
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }
  
  try {
    // Verify authentication with Firebase Auth
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(403).json({ error: 'Unauthorized: No valid authentication token provided' });
      return;
    }
    
    const idToken = authHeader.split('Bearer ')[1];
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    
    // Only allow verified admins to send notifications
    // You should implement proper role-based checks here
    
    // Get the request body
    const data = req.body;
    if (!data.message || !data.message.notification) {
      res.status(400).json({ error: 'Invalid request body' });
      return;
    }
    
    let results = [];
    
    // Send message based on targeting type (token or topic)
    if (data.message.token) {
      // Send to specific device
      const result = await admin.messaging().send(data.message);
      results.push(result);
      
      // If additional tokens exist, send to those as well
      if (data.additionalTokens && Array.isArray(data.additionalTokens) && data.additionalTokens.length > 0) {
        // Create messages for each token with the same content
        const messages = data.additionalTokens.map(token => ({
          ...data.message,
          token: token
        }));
        
        // Send in batches of 500 (FCM limit)
        while (messages.length) {
          const batch = messages.splice(0, 500);
          const batchResult = await admin.messaging().sendAll(batch);
          results.push({
            batchSize: batch.length,
            successCount: batchResult.successCount,
            failureCount: batchResult.failureCount
          });
        }
      }
    } else if (data.message.topic) {
      // Send to topic
      const result = await admin.messaging().send(data.message);
      results.push(result);
    } else {
      res.status(400).json({ error: 'Invalid message: must include either token or topic' });
      return;
    }
    
    // Log the successful operation
    functions.logger.info('Notifications sent', results);
    
    // Return success with results
    res.status(200).json({ 
      success: true, 
      results: results 
    });
    
  } catch (error) {
    functions.logger.error('Error sending notification:', error);
    res.status(500).json({ 
      error: error.message 
    });
  }
});

// Optional: Subscribe all users to the 'all' topic when they register a new FCM token
exports.subscribeToTopic = functions.database.ref('/users/{userId}/fcmToken').onWrite(async (change, context) => {
  const fcmToken = change.after.val();
  const userId = context.params.userId;
  
  // Skip if token was deleted or is null
  if (!fcmToken) {
    console.log(`FCM Token removed or null for user ${userId}`);
    return null;
  }
  
  try {
    // Subscribe the device to the 'all' topic
    const response = await admin.messaging().subscribeToTopic(fcmToken, 'all');
    console.log(`Successfully subscribed ${userId} to topic:`, response);
    return response;
  } catch (error) {
    console.error(`Error subscribing ${userId} to topic:`, error);
    return null;
  }
});

// Optional: Trigger notification when new promotions are added
exports.sendNewPromotionNotification = functions.database.ref('/banners/{bannerId}')
  .onCreate(async (snapshot, context) => {
    const banner = snapshot.val();
    
    // Only send notification if banner is active
    if (!banner || !banner.active) {
      return null;
    }
    
    const message = {
      notification: {
        title: 'New Promotion Available!',
        body: banner.title || 'Check out our latest offer in the app',
      },
      android: {
        notification: {
          icon: 'ic_launcher_foreground',
          color: '#6200EE',
          clickAction: 'OPEN_PROMOTION'
        }
      },
      data: {
        bannerType: 'promotion',
        bannerId: context.params.bannerId
      },
      topic: 'all'
    };
    
    // Add image if available
    if (banner.imageUrl) {
      message.notification.image = banner.imageUrl;
      message.android.notification.image = banner.imageUrl;
    }
    
    try {
      const response = await admin.messaging().send(message);
      console.log('Notification sent for new promotion:', response);
      return response;
    } catch (error) {
      console.error('Error sending promotion notification:', error);
      return null;
    }
  }); 