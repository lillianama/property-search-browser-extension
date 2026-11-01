# 💜 Nova Nest · Browser Extension

**A tiny Zillow sidekick for your property shortlist.**

You browse the houses. This little bird carries the useful bits home. No spreadsheet séance required.

Nova Nest is a **Chrome Manifest V3 extension** that reads supported Zillow listing pages you open and sends validated listing observations to your own [Nova Nest dashboard](https://github.com/lillianama/property-search-dashboard). The dashboard is where you compare properties, keep notes, and decide which ones deserve real shoes and a tour.

## 🐣 What it does

- **Recognizes tracked listings** using exact identifiers and supported source aliases—not “same-ish address, probably fine.”
- **Syncs supported published facts** such as price/status, beds/baths, area, taxes, photos, listing history, room measurements, and unit/rent details when present and valid. Missing data stays missing.
- **Offers Add to Watchlist** for eligible untracked listings. Choose **House** or **Plex**, then click deliberately. Browsing does not create records; existing decisions stay intact.
- **Shows an in-page badge** for saves, untracked listings, blocked capture, and connection problems. Failed captures retry with the same capture identity rather than inventing a fresh event each time.
- **Keeps apartment scope separate.** A supported apartment-range page may recognize an already tracked whole property while showing “Whole property tracked; apartment capture blocked.” That is recognition only: no apartment facts imported, no apartment ZPID binding, and no duplicate Add button.

It is not a background Zillow crawler, a bulk importer, or a magic MLS feed. Alas, the bird has boundaries.

<a id="quick-start"></a>

## 🚀 Quick Start · Let it perch in Chrome

You need a running dashboard with its browser-observation API configured. This extension is currently loaded **unpacked**, not installed from a Chrome Web Store release; there is no build step.

1. **Get the files:** use GitHub's **Code → Download ZIP** on the [`develop` branch](https://github.com/lillianama/property-search-browser-extension/tree/develop), then unzip it. Or clone directly:

   ```sh
   git clone --branch develop https://github.com/lillianama/property-search-browser-extension.git
   ```

2. **Load the bird:** open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the extracted/cloned folder containing `manifest.json`—not the ZIP or its parent folder. Keep that folder somewhere stable.
3. **Pin Nova Nest:** open Chrome's puzzle-piece **Extensions** menu and click the pin beside **Nova Nest** so it is easy to find.
4. **Connect the dashboard:** copy Nova Nest's extension ID from `chrome://extensions`. Your dashboard operator must allow that ID and configure the observation schema, restricted database role, and scoped token. See [dashboard setup](https://github.com/lillianama/property-search-dashboard#browser-observations).
5. **Open Options:** on Nova Nest's card at `chrome://extensions`, choose **Details → Extension options**. Fill **HTTPS dashboard origin** with your actual dashboard's HTTPS scheme + hostname (and port if needed; no path). Fill **Scoped bearer token** with the private token supplied by your operator. Click **Save** and allow access to that dashboard origin when Chrome asks. No credentials belong in this README. The bird can keep a secret.
6. **Try a listing:** visit or refresh a supported Zillow property page. The in-page badge reports save/connection status, offers **Add to Watchlist** only when eligible, or explains why capture is blocked. A whole-property recognition badge on an apartment page does not mean apartment facts were saved.

The dashboard API must accept the extension's preflight and bearer-authenticated requests; an interactive proxy login redirect will not work. You do not paste database credentials into the extension. Tiny bird, tiny job description.

### Updating

Pull the latest `develop` changes (or replace your downloaded files), click **Reload** at `chrome://extensions`, then refresh Zillow tabs. Keep the bundled manifest key unchanged so the extension ID stays stable. This repo does not automatically update an unpacked installation.

## 🔐 Your nest, your data

- The extension runs on `https://www.zillow.com/*` and requests optional access to the dashboard origin you configure. It does not ask for all-site browsing access at installation.
- The dashboard origin and token are stored in **Chrome local extension storage**, restricted to trusted extension contexts—not Chrome sync storage or the listing page. Treat the token as a secret; never commit or share it.
- The worker sends allowlisted listing observations and identity evidence to your configured dashboard over HTTPS. It does not upload your whole browsing history or arbitrary page HTML.
- Automatic capture applies only to safely matched tracked properties. New Watchlist intake requires your explicit click and valid supported evidence; ambiguous identities and unit/whole-building mismatches remain blocked.
- Backend validation and capture history preserve provenance and existing manual judgments. A green recognition badge is not permission to mix a studio apartment's square footage into a duplex. That math is cursed.

The code is public; your configured dashboard and property records are yours to keep private. No hosted account or sample private data is bundled.

## 🩹 If the bird looks confused

- **Settings/authorization:** check the HTTPS origin, saved token, allowed extension ID, and granted site permission.
- **Dashboard unavailable:** check connectivity and proxy routing; the extension retries transient failures.
- **Not tracked:** use Add to Watchlist only when offered and you actually want to add the listing.
- **Capture blocked/incomplete:** identity, scope, or a published field could not be validated. Do not strip unit numbers or force a whole-building match. Not every Zillow layout is supported, and human-verification pages cannot provide a valid capture.

## 🧪 Developer check

With a current Node.js runtime:

```sh
node --test test/*.test.cjs
```

Tests cover extraction, identity/scope boundaries, worker requests, intake, and badge behavior using fixtures. They do not prove a particular live Zillow page or installed Chrome session works; verify those separately. The nest is cozy, not clairvoyant.
