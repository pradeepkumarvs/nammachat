# NammaChat

Anonymous, location-based meetup and chat service for Chennai, Tamil Nadu.

## Deploy
- Drop `index.html` onto Vercel or Netlify (drag-and-drop deploy).
- Or serve locally with any static server (e.g., `npx serve .`).

## Configure Before Production
1. **Firebase**
   - Create a project at [Firebase Console](https://console.firebase.google.com/).
   - Enable Realtime Database (Asia Southeast1 recommended for Chennai latency).
   - Copy your config object and replace the dummy `firebaseConfig` in `index.html`.
   - Set database rules (example below) so unauthenticated users can read/write presence and messages. For production, add Firebase Anonymous Auth or proper Auth rules.

   ```json
   {
     "rules": {
       "presence": {
         ".read": true,
         ".write": true
       },
       "chats": {
         "$chatId": {
           ".read": true,
           ".write": true
         }
       },
       "reports": {
         ".read": false,
         ".write": true
       }
     }
   }
   ```

2. **Razorpay**
   - Replace the dummy `key: 'rzp_test_dummyKeyForDemo'` with your actual Razorpay Test/Live Key.
   - Create the "Spotlight Pass" product in your Razorpay Dashboard.

## Features
- HTML5 Geolocation with `enableHighAccuracy: true`
- Haversine distance filtering (1 / 3 / 5 / 10 km)
- Interactive Leaflet.js map with radius circle
- Realtime 1-on-1 chat via Firebase Realtime Database
- Online/offline presence with `onDisconnect`
- Report / Block safety controls
- "Request Profile Reveal" mutual-consent feature
- Spotlight Pass (₹19) via Razorpay Checkout
- Mobile-first responsive UI

## Tech Stack
- HTML5 / Tailwind-like utility CSS (vanilla CSS)
- Leaflet.js + OpenStreetMap (free)
- Firebase Realtime Database (free tier)
- Razorpay Checkout JS SDK
