const express = require('express');
const fetch = require('node-fetch');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');

const app = express();
const port = 3000;

// --- Firebase Admin SDK Setup ---
const admin = require('firebase-admin');

// Check if the service account environment variable is set
if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
  try {
    // Decode the Base64 string and parse it as JSON
    const serviceAccount = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8'));

    // Initialize Firebase Admin SDK
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log('Firebase Admin SDK initialized successfully.');

    // Example: Access Firestore (if you plan to use it)
    // const db = admin.firestore();
    // console.log('Firestore instance obtained.');

  } catch (error) {
    console.error('Failed to initialize Firebase Admin SDK:', error);
  }
} else {
  console.warn('FIREBASE_SERVICE_ACCOUNT_BASE64 environment variable not set. Firebase Admin SDK will not be initialized.');
}

// --- Database Setup ---
const adapter = new FileSync('db.json');
const db = low(adapter);
db.defaults({ links: [] }).write();

// --- Middleware ---
app.set('view engine', 'ejs');
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
  if (db.get('links').find({ customPath }).value()) {
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

    // Save the new link to our database
    db.get('links').push({ customPath, displayTitle, links, thumbnailUrl }).write();

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

app.get('/list', (req, res) => {
  const allLinks = db.get('links').value();
  res.render('list', { allLinks });
});

app.get('/:customPath', (req, res) => {
  const { customPath } = req.params;
  const linkData = db.get('links').find({ customPath }).value();

  if (linkData) {
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
});

// --- Start Server ---
// app.listen(port, () => {
//   console.log(`Server is running on port ${port}`);
// });

module.exports = app;
