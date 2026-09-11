# Ridango POS 2.0

Progressive web app for the Ridango point-of-sale device (1024 × 600 touch display) that sells
public-transport tickets. Multi-client and multi-environment: each client-environment ships its own
fare data ("fullset" export) and branding.

Design source: Figma "POS Device 2.0", node `213-914`.

## Run

No build step. Serve the folder with any static web server and open it in Chrome:

```bash
cd Ridango_POS_2.0
python3 -m http.server 8765
# → http://localhost:8765/
```

or `npx serve .`. Install it as a PWA from the browser menu (the manifest requests fullscreen
landscape). A service worker precaches the app shell and caches fare data after the first load,
so the app keeps working offline.

## Structure

```
index.html              app shell
manifest.webmanifest    PWA manifest
sw.js                   service worker (precache shell, network-first fare data)
clients.json            registry of client-environments
styles/main.css         design tokens + component styles
src/app.js              screens, modals, cart, actions
src/fare-model.js       fullset resolver (versions → entities → sellable offers per zone)
src/format.js           price and clock formatting
assets/icons, logos     SVGs exported from Figma
data/<client-env>/      fare data per client-environment
```

## Adding a client-environment

1. Put the fullset export in `data/<client>-<environment>/`.
2. Put the client logo (SVG, white on transparent) in `assets/logos/`.
3. Add an entry to `clients.json`:

```json
{
  "id": "sormland-test",
  "name": "Sörmland",
  "environment": "test",
  "logo": "assets/logos/sormland.svg",
  "logoHeight": 42,
  "dataFile": "data/sormland-test/<fullset>.json",
  "distributionChannel": "DistributionChannel@<id of the POS channel>",
  "locale": "sv-SE",
  "language": "sv"
}
```

`distributionChannel` selects which channel's products are shown. Leave it `null` to show products
assigned to every channel of type `TypeOfDistributionChannel@pos`. Assignments made to a
distribution-channel group that contains the channel are included as well.

The user taps the logo in the header to switch client.

## How the catalogue is derived

* All frames of the fullset are merged; later versions (`?4`, `?5`) override earlier ones.
* **Zones** (header dropdown and modal): `FareZone` entities that are not groups, sorted by name.
* **Tabs**: `TypeOfFareProduct` values in their `sortOrder`, only those with sellable products
  in the selected zone.
* **Cards**: one per `SalesOfferPackage` × allowed `UserProfile`, for packages with a
  `DistributionAssignment` on the POS channel (or a group containing it). A card is shown in a
  zone when the product's `NetworkValidityParameter` zones include it, directly or via a zone
  group; the second line names the covered area (zone or group, e.g. "Västmanland county +").
* **Prices**: `FareTable` cells matched on user profile and zone (exact zone beats zone group,
  beats unspecified). Amounts are in minor units incl. VAT and formatted with the client locale.
* Products with no `typeOfFareProduct` (e.g. the travel card) are listed under
  "Travel document".

Confirming a cart logs the sale object to the console (`Sale confirmed`); that is the hook for the
ticketing backend.
