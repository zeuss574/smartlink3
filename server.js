require('dotenv').config();

const express = require('express');
const path = require('path');
const fetch = require('node-fetch');
const { inject } = require('@vercel/speed-insights');

const app = express();
const port = 3000;

// --- Firebase Admin SDK Setup ---
const admin = require('firebase-admin');
let db; // Declare db variable here

// Check if the service account environment variable is set
if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
  // Check if a Firebase app has already been initialized
  if (!admin.apps.length) {
    console.log('FIREBASE_SERVICE_ACCOUNT_BASE64 environment variable is set.');
    console.log('First 50 chars of Base64 string:', process.env.FIREBASE_SERVICE_ACCOUNT_BASE64.substring(0, 50) + '...');
    try {
      // Decode the Base64 string and parse it as JSON
      const serviceAccount = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8'));

      // Initialize Firebase Admin SDK
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      db = admin.firestore(); // Initialize Firestore
      console.log('Firebase Admin SDK initialized successfully and Firestore instance obtained.');

    } catch (error) {
      console.error('Failed to initialize Firebase Admin SDK:', error);
      console.error('Error details:', error.message);
    }
  } else {
    console.log('Firebase Admin SDK already initialized. Skipping re-initialization.');
    db = admin.firestore(); // Ensure db is set even if already initialized
  }
} else {
  console.warn('FIREBASE_SERVICE_ACCOUNT_BASE64 environment variable not set. Firebase Admin SDK will not be initialized.');
}

// --- Middleware ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

// --- Routes ---

// Homepage to create links
app.get('/', (req, res) => {
  res.render('index', { error: null, success: null });
});

// Create a new smartlink
app.post('/create', async (req, res) => {
  const { musicUrl, title: customPath } = req.body; // Rename title to customPath

  // Basic validation for the custom path
  if (!customPath || !/^[a-zA-Z0-9-_]+$/.test(customPath)) {
    return res.render('index', {
      error: 'Custom path can only contain letters, numbers, hyphens (-), and underscores (_).',
      success: null
    });
  }

  // Check if custom path is already in use
  const docRef = db.collection('links').doc(customPath);
  const doc = await docRef.get();
  if (doc.exists) {
    return res.render('index', { error: 'This custom path is already taken.', success: null });
  }

  try {
    // Fetch data from the Odesli/Songlink API
    const response = await fetch(`https://api.song.link/v1-alpha.1/links?url=${encodeURIComponent(musicUrl)}`);
    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }
    const data = await response.json();
    console.log("Odesli API Response:", JSON.stringify(data, null, 2)); // Temporary log for debugging

    // Ensure the API returned the necessary data
    if (!data.linksByPlatform || !data.entitiesByUniqueId || !data.entityUniqueId) {
      return res.render('index', { error: 'Could not find music data for this URL. Please check the link and try again.', success: null });
    }

    const links = data.linksByPlatform;
    const entity = data.entitiesByUniqueId[data.entityUniqueId];
    let thumbnailUrl = entity ? entity.thumbnailUrl : 'https://via.placeholder.com/200';
    let releaseName = entity.title || 'Unknown Release';

    // Prefer Spotify thumbnail and title if available
    if (links.spotify && links.spotify.entityUniqueId) {
      const spotifyEntity = data.entitiesByUniqueId[links.spotify.entityUniqueId];
      if (spotifyEntity) {
        if (spotifyEntity.thumbnailUrl) {
          thumbnailUrl = spotifyEntity.thumbnailUrl;
        }
        if (spotifyEntity.title) {
          releaseName = spotifyEntity.title;
        }
      }
    }

    // Construct the display title
    const artistName = entity.artistName || 'Unknown Artist';
    const displayTitle = `${artistName} - ${releaseName}`;

    // Get creation date and time
    const now = new Date();
    const creationDate = `${now.toLocaleDateString('en-GB')} - ${now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;

    // Get IP and location info
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    let locationInfo = {};
    try {
        const ipApiResponse = await fetch(`http://ip-api.com/json/${ip}`);
        const ipApiData = await ipApiResponse.json();
        if (ipApiData.status === 'success') {
            locationInfo = {
                country: ipApiData.country,
                isp: ipApiData.isp,
            };
        }
    } catch (error) {
        console.error('Error fetching IP geolocation data:', error);
    }

    // Get device info
    const deviceInfo = req.headers['user-agent'];

    // Save the new link to Firestore
    await db.collection('links').doc(customPath).set({
      customPath,
      displayTitle,
      links,
      thumbnailUrl,
      creationDate,
      deviceInfo,
      ip,
      locationInfo
    });

    const successUrl = `https://${req.headers.host}/${customPath}`;
    res.render('index', { error: null, success: `Success! Your link is ready: ${successUrl}` });

  } catch (error) {
    console.error(error);
    res.render('index', { error: 'An unexpected error occurred while creating the link.', success: null });
  }
});

// Display the smartlink page
const platformDisplayInfo = {
  spotify: { iconSlug: 'spotify', displayName: 'Spotify' },
  appleMusic: { iconSlug: 'applemusic', displayName: 'Apple Music' },
  youtubeMusic: { iconSlug: 'youtubemusic', displayName: 'YouTube Music' },
  amazonMusic: { iconSlug: 'amazonmusic', displayName: 'Amazon Music' },
  deezer: { iconSlug: 'deezer', displayName: 'Deezer' },
  tidal: { iconSlug: 'tidal', displayName: 'Tidal' },
  soundcloud: { iconSlug: 'soundcloud', displayName: 'SoundCloud' },
  pandora: { iconSlug: 'pandora', displayName: 'Pandora' },
  itunes: { iconSlug: 'itunes', displayName: 'iTunes' },
  youtube: { iconSlug: 'youtube', displayName: 'YouTube' },
  googleplay: { iconSlug: 'googleplay', displayName: 'Google Play' },
  napster: { iconSlug: 'napster', displayName: 'Napster' },
  yandexmusic: { iconSlug: 'yandexmusic', displayName: 'Yandex Music' },
  vk: { iconSlug: 'vk', displayName: 'VK' },
  qobuz: { iconSlug: 'qobuz', displayName: 'Qobuz' },
  joox: { iconSlug: 'joox', displayName: 'JOOX' },
  kkbox: { iconSlug: 'kkbox', displayName: 'KKBOX' },
  audiomack: { iconSlug: 'audiomack', displayName: 'Audiomack' },
  bandcamp: { iconSlug: 'bandcamp', displayName: 'Bandcamp' },
  boomplay: { iconSlug: 'boomplay', displayName: 'Boomplay', iconUrl: 'https://assets.ffm.to/images/logo/music-service_boomplay_updated.png' },
  // Add more as needed based on Odesli API response
};

// Helper to format platform names if not explicitly mapped
function formatPlatformName(name) {
  // Handle common camelCase to space-separated words
  let formattedName = name.replace(/([A-Z])/g, ' $1');
  // Capitalize the first letter of each word
  formattedName = formattedName.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  // Specific corrections for common API names
  formattedName = formattedName.replace('Youtube', 'YouTube');
  formattedName = formattedName.replace('Applemusic', 'Apple Music');
  formattedName = formattedName.replace('Amazonmusic', 'Amazon Music');
  formattedName = formattedName.replace('Googleplay', 'Google Play');
  formattedName = formattedName.replace('Yandexmusic', 'Yandex Music');

  return formattedName;
}

const preferredOrder = [
  'spotify',
  'appleMusic',
  'itunes',
  'amazonMusic',
  'deezer',
  'youtubeMusic',
  'youtube',
  'tidal',
];

app.get('/list', async (req, res) => {
  try {
    const snapshot = await db.collection('links').get();
    const allLinks = snapshot.docs.map(doc => doc.data());
    res.render('list', { allLinks });
  } catch (error) {
    console.error('Error fetching links from Firestore:', error);
    res.render('list', { allLinks: [] }); // Render with empty array on error
  }
});

app.get('/:customPath', async (req, res) => {
  const { customPath } = req.params;
  try {
    const doc = await db.collection('links').doc(customPath).get();

    if (doc.exists) {
      const linkData = doc.data();
      res.render('link', {
        title: linkData.displayTitle,
        links: linkData.links,
        thumbnailUrl: linkData.thumbnailUrl,
        platformDisplayInfo: platformDisplayInfo,
        formatPlatformName: formatPlatformName,
        preferredOrder: preferredOrder
      });
    } else {
      res.status(404).render('404');
    }
  } catch (error) {
    console.error('Error fetching single link from Firestore:', error);
    res.status(500).render('404'); // Render 404 or an error page on database error
  }
});

// --- Start Server ---
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

module.exports = app;
