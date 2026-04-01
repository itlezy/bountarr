This specification outlines a lightweight, modern web frontend designed for local network (LAN) use. It serves as a simplified "Request & Audit" layer for **Radarr** and **Sonarr**, focusing on media discovery and automated verification of language/subtitles post-download.

---

## 🛠 Tech Stack & Architecture

* **Framework:** SvelteKit (using Svelte 5 runes for high-performance reactivity).
* **Build Tool:** Vite (for near-instant HMR and optimized builds).
* **Styling:** UnoCSS (Atomic CSS engine with high performance and mobile-first utilities).
* **Runtime/Process Management:** Node.js, managed by **PM2**.
* **Storage:** LocalStorage/Cookies (User preferences) + Radarr/Sonarr APIs.
* **Notifications:** Browser Web Notifications API (Local) + optional Gotify/ntfy integration.

---

## 📋 Functional Requirements

### 1. Media Discovery & Selection
* **Search:** Real-time search for Movies (Radarr) and Shows (Sonarr).
* **Selection:** One-click "Request" that sends the metadata to the respective *Arr instance via API.
* **Responsive UI:** A "Netflix-style" grid for desktop that collapses into a single-column scrollable list for mobile.

### 2. Post-Download Language & Subtitle Audit
* **Polling/Webhook:** The app polls the *Arr "History" or "Queue" to detect completed downloads.
* **Verification Logic:**
    1.  Access the file path via the *Arr API.
    2.  Use the API's `mediaInfo` or a lightweight Node worker to check:
        * **Audio Streams:** Does it contain the user's preferred language (e.g., "eng", "spa")?
        * **Subtitle Streams:** Are internal or external `.srt` files present?
    3.  **Status Badges:** Display "Verified," "Missing Language," or "No Subs" on the dashboard.

### 3. User Preferences (No Auth)
* **Storage:** Save settings in `localStorage`.
* **Configurable Items:**
    * Target Radarr/Sonarr IP and API Keys.
    * Preferred Language (e.g., "English").
    * Subtitle requirement (Boolean).
    * Theme (Light/Dark).

### 4. Notifications
* **Triggers:** Notify when a search is successful, a download starts, or a download fails the language/subtitle audit.
* **Local:** Use the standard Browser Notification API.

---

## 🏗 System Design



---

## 🚀 Implementation Details

### PM2 Deployment Configuration
Create an `ecosystem.config.cjs` to ensure the app stays alive and restarts on crash:

```javascript
module.exports = {
  apps: [{
    name: "media-requester",
    script: "build/index.js",
    env: {
      NODE_ENV: "production",
      PORT: 3000,
      ORIGIN: "http://localhost:3000" // Change to your LAN IP
    },
    instances: 1,
    exec_mode: "fork"
  }]
}
```

### UnoCSS Mobile-First Setup
The UI should utilize UnoCSS's shortcut features for a clean, mobile-optimized "Card" layout:

```html
<div class="p-4 rd-lg bg-gray-800 flex flex-col sm:flex-row gap-4">
  <img src={poster} class="w-full sm:w-32 aspect-2/3 rd shadow-md" />
  <div class="flex-1">
    <h2 class="text-xl font-bold text-white">{title}</h2>
    <div class="mt-auto flex justify-between items-center">
      <button class="bg-blue-600 hover:bg-blue-500 px-4 py-2 rd transition-colors">
        Request
      </button>
    </div>
  </div>
</div>
```

---

## 🚦 Verification Workflow

1.  **Selection:** User hits "Request" on the Frontend.
2.  **API Call:** Frontend calls Node backend -> Node backend calls Radarr `POST /api/v3/movie`.
3.  **Monitoring:** Node backend checks Radarr `GET /api/v3/history` every 5 minutes.
4.  **Audit:** When status is "Completed", Node queries the file's `movieFile` object.
5.  **Validation:**
    * If `mediaInfo.audioLanguages` includes `pref_lang` → **Pass**.
    * If `mediaInfo.subtitleLanguages` exists → **Pass**.
6.  **Alert:** If either fail, trigger a system notification: *"Warning: [Movie Name] downloaded but missing [Language] subtitles."*

---

## 🛡 Security & LAN Considerations
* **No Auth:** Since there is no login, ensure this is **not** exposed to the internet. Use a VPN (Tailscale/Wireguard) to access it remotely.
* **CORS:** The Node backend must act as a proxy for the *Arr APIs to avoid Browser CORS issues when calling different ports (8989/7878) from the main app port (3000).

Would you like the specific API endpoints for checking file metadata in Radarr and Sonarr to get started on the logic?