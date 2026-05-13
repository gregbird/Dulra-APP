# Mobile Field Guide

This guide walks you through the Dulra mobile app the way you will use it in the field — from signing in on the phone to capturing watermarked GPS photos for a site. Mobile is built around **Step 4: Field Research** in the project lifecycle. Project setup (Steps 1–3) and reporting (Steps 5–8) still happen on the web; mobile is the offline-first capture tool you carry on the survey.

> **Note:** Every screen in this guide works offline. Anything you record while disconnected is queued locally and pushed to Supabase the moment the phone is online again.

---

## 1. Sign In — Field Survey Application

**Screenshot:** `IMG_0268.PNG`

The launch screen where you sign in with the same credentials you use on dulra.app on the web.

**Layout overview:**
1. **Dulra wordmark + "Field Survey Application" subtitle.** Confirms you opened the field app, not the desktop site.
2. **Email field.** Placeholder `name@email.com`. Auto-capitalisation is off, so you can type lowercase emails without fighting the keyboard.
3. **Password field.** Masked input with a "Done" return key that submits the form.
4. **Sign In button.** Full-width green primary button. Shows a spinner while authentication runs.

**Your task on this screen.**
- Type the email tied to your Dulra account.
- Type your password.
- Tap **Sign In**.

> **Important:** Your session is stored in the secure enclave of the device. You stay signed in across app restarts and can keep working offline for days — the app only re-validates the token when it reconnects.

> **Note:** There is no "Forgot password" link inside the app. If you cannot sign in, ask a project manager to reset your password from the web admin.

> **Recommendation:** Sign in once over Wi-Fi before you drive to the site. The first sign-in must reach Supabase, and the same session then carries you through the day without coverage.

> **Platform note:** On iOS the keyboard's autofill suggestions appear above the input. Tap the suggestion or type manually — both work.

▎ Cross-platform note: This is the only entry point on mobile. The web app at dulra.app uses the same accounts.

---

## 2. Projects — Project List

**Screenshot:** `IMG_0269.PNG`

The home tab. Every project you are a member of (plus everything you created) is listed here, sorted by most recently updated.

**Layout overview:**
1. **"Projects" title.** Static header. The tab bar at the bottom switches between **Projects** and **Settings**.
2. **Search bar.** Free-text filter over project name, county and site code. Typing "gal" narrows to the Galway projects in the example.
3. **Project cards.** Each card shows the project name (`Ecologist Project`), county chip (`Galway`), site code (`EP-2026-907`), status pill (`Active` / `Completed`), health pill (`On Track`, `At Risk` or `Overdue`) and the last-updated date (`11 May 2026`).
4. **Bottom tabs.** **Projects** (folder icon) is the current tab; **Settings** (gear icon) opens your profile.

**Your task on this screen.**
- Find the project you are surveying today. Use search if the list is long.
- Tap the card to open the project. The whole row is a tap target.
- Pull down to refresh if you suspect a teammate just published a new project.

> **Note:** The list is cached locally. If you open the app with no signal, you still see every project you had access to at your last online session — date and status frozen at that snapshot.

> **Important:** If a project you expect is missing, you are probably not a member yet. Project membership is set on the web in Step 1; mobile cannot grant access.

▎ Cross-platform note: Same data as the web Projects list. Project order and status badges match.

---

## 3. Project Detail — Sections & Boundary Preview

**Screenshot:** `IMG_0270.PNG`

The project landing page. Shows the county, site code, the site you are working on and a live boundary preview, with one row per data type you can capture.

**Layout overview:**
1. **County and code row.** `Galway` and `EP-2026-907` at the top, read straight from the project record.
2. **Site dropdown.** `EP 00001` here. Multi-site projects let you pick which site to scope the screen to; single-site projects auto-select.
3. **Boundary preview map.** A non-interactive thumbnail tinted by your selection. The red box is the selected site's bounding boundary; the dashed red ring is the project boundary buffer. Tap **Open map** in the bottom-right pill to launch the full map.
4. **Section cards.** **Surveys**, **Habitats**, **Target Notes**, **Photos**. Each shows a record count if data already exists (e.g. `1 records`) or a description if not (e.g. `General site photographs for the project`).
5. **Start New Survey button.** Scrolls into view at the bottom of the screen — green, full-width, launches the survey type picker.

**Your task on this screen.**
- Confirm the site dropdown is on the site you are actually standing in.
- Tap the section you need: **Surveys** for a new walkover, **Habitats** to review imported polygons, **Target Notes** for ad-hoc observations, **Photos** for general site shots.
- Tap **Start New Survey** to jump straight into a fresh survey for this site.

> **Important:** On multi-site projects you must pick a site before starting a survey. Otherwise the survey would save with `site_id=null` and disappear from any site-filtered view.

> **Note:** Pull-to-refresh re-counts records against Supabase if you are online and falls back to the cache if you are not.

---

## 4. Project Map — Full View

**Screenshot:** `IMG_0271.PNG`

The full-screen map for the project, opened from the **Open map** pill on the project detail screen. Designated conservation sites (SAC, SPA, NHA, pNHA) are coloured outlines, the project boundary is the dashed red ring, and your sites are the solid red boxes inside.

**Layout overview:**
1. **Back chevron and project title.** Top-left chevron returns to the project detail screen; title repeats the project name.
2. **Site dropdown.** `All Sites` zooms out to the full project bbox. Picking a single site zooms in and re-centres the map on that site only.
3. **Layers FAB (top-left, stacked squares icon).** Opens the layer sheet (see next section). A purple dot on the icon means at least one non-default overlay is active.
4. **Map canvas.** Pan and pinch as on any map. Initial centre and zoom are computed from the project's boundary.
5. **Legend (bottom-left).** `SAC`, `SPA`, `NHA`, `pNHA` swatches. Visible while you have designated-site overlays loaded.

**Your task on this screen.**
- Pan to your real-world location. The boundary box should match what you see on the ground.
- Tap the **Layers** button to switch base map or enable habitat/NLC/aquatic overlays.
- Use the **All Sites** dropdown to focus on the site you are surveying — that filters habitats and notes elsewhere too.

> **Note:** No live GPS dot is drawn on this map. Your phone's location is read when you create a survey or photo, not as a moving cursor here.

> **Recommendation:** Before driving out, open this map once on Wi-Fi so the base tiles for the area are cached. Tiles are best-effort offline — the more you pan around a region online, the more you keep when you lose signal.

---

## 5. Map Layers Sheet — Base, Boundaries, Survey Layers

**Screenshot:** `IMG_0272.PNG`

The bottom sheet behind the **Layers** FAB. Three independent groups: pick one base map, then toggle the overlays you need on top.

**Layout overview:**
1. **Base Map (radio group).** **Streets**, **Satellite**, **Hybrid**, **Topographic**. Single-select — the dot fills on the active option.
2. **Boundaries (checkbox group).** **Townlands** with the hint `Visible at zoom 12+`. Townland polygons only paint once you zoom in past z12.
3. **Survey Layers (checkbox group).** **Habitats** (FOSSITT-coloured polygons from field surveys), **NLC reference** (National Land Cover 2018 parcels, visible at zoom 16+), **Aquatic features** (EPA water bodies and catchments — turning this on hides Habitats and NLC because the colours would clash).
4. **Done button.** Green primary, applies the selection and closes the sheet.

**Your task on this screen.**
- Pick the base map that suits the task: **Satellite** for habitat ID, **Topographic** for terrain context, **Streets** for navigation, **Hybrid** when you want both labels and imagery.
- Enable **Habitats** to see polygons your team has saved.
- Enable **NLC reference** only at high zoom — it is intentionally hidden below z16 to keep the map readable.
- Tap **Done** to dismiss.

> **Important:** **Aquatic features** is mutually exclusive with Habitats and NLC. The screen enforces the mutex — turning Aquatic on auto-hides the other two so you do not see overlapping colour fills.

> **Note:** The purple dot on the **Layers** FAB lights up if any non-default overlay is active (Townlands, Habitats or Aquatic). NLC defaults on, so the dot does not light for it.

▎ Cross-platform note: The same overlays exist on the web map (Step 4 → Map view). The mutex rule between Aquatic and Habitats/NLC matches the web.

---

## 6. Project Map — NLC Reference at High Zoom

**Screenshot:** `IMG_0273.PNG`

The same project map zoomed past z16 with the **NLC reference** layer enabled. Each numeric label (`110`, `130`, `240`) is a National Land Cover 2018 parcel coloured by its Level-2 value.

**Layout overview:**
1. **Map canvas.** Aerial base; tinted parcels overlaid by NLC.
2. **NLC parcel polygons.** The number inside each parcel is the NLC Level-2 code. Colours follow Dulra's NLC palette, mapped one-to-one with FOSSITT codes where possible.
3. **Tap targets.** Tap a parcel to open the NLC detail sheet (code, area, suggested FOSSITT mapping). The sheet is the same one used on the web.

**Your task on this screen.**
- Pinch out until the NLC parcels appear (z16+). Below that zoom the layer hides itself.
- Tap a parcel to see its code, area and the suggested FOSSITT mapping.
- Use the parcel as a head-start for habitat mapping — confirm or override on the web in Step 4.

> **Note:** NLC is a *reference* layer. Tapping a parcel does not create a habitat on its own — habitat polygons are still saved through the web's Field Survey step.

> **Recommendation:** Pair this view with **Satellite** as the base map. Imagery underneath the NLC fill helps you spot mis-classified parcels (e.g. an NLC "grassland" parcel that is now scrub).

> **Important:** NLC has a server-side row cap. If you are in a project that covers tens of square kilometres, parcels far from your viewport may not render until you pan to them.

---

## 7. Project Map — Topographic Base

**Screenshot:** `IMG_0274.PNG`

The same map with **Topographic** selected as the base map. The boundary, site box and townland outlines are still painted on top.

**Layout overview:**
1. **Topographic tiles.** Contour-style cartography from the topo provider. Road names, place names and hill shading come from the base map service.
2. **Project boundary (dashed red ring).** Same buffer as on every base map.
3. **Selected site (solid red box).** The site picker controls which box is highlighted.
4. **Townland boundaries.** Visible because you have crossed the z12 threshold and the Townlands toggle is on.

**Your task on this screen.**
- Switch to **Topographic** when you want terrain cues — slope, watercourses, hill names — alongside your project boundary.
- Use this view for route planning when the satellite tiles are too dense or out of date.

> **Note:** Topographic is the lightest base map for offline use. The tiles are simple vector renderings, so they cache better than satellite imagery when bandwidth is patchy.

> **Recommendation:** For habitat photo work, switch back to **Satellite** before tapping any parcel. Topographic obscures vegetation patterns that satellite reveals immediately.

---

## 8. Project Map — Standard View with Townlands

**Screenshot:** `IMG_0275.PNG`

The default **Streets** base map at mid-zoom. The dashed red ring is the project boundary buffer, the solid red box is the focused site, and the green polygon south-west of the boundary is the next-door site outline.

**Layout overview:**
1. **Streets tiles.** Standard road map cartography.
2. **Project boundary.** Dashed red, drawn on top of every base map.
3. **Adjacent site polygons (green).** Other sites on the same project, drawn so you can see their relationship to the one you have selected.
4. **Townland labels and edges.** Drawn once zoom is 12 or higher.

**Your task on this screen.**
- Use this base for orientation when driving between sites — the road network is clearest here.
- Confirm the dashed red boundary matches where you are going *before* you leave a paved road. If it is off, double-check you picked the right site.

> **Note:** "Streets" is the only base map with road labels at small scales. The other bases pick labels up only at higher zoom.

---

## 9. Surveys — Site Survey List

**Screenshot:** `IMG_0276.PNG`

The list of surveys recorded for a specific site, scoped by the site dropdown. Two tabs: **Active** (in-progress) and **Completed**.

**Layout overview:**
1. **Back button.** Returns to the project detail screen.
2. **Site dropdown.** `EP 00001`. Same control as on the project detail; defines what the list filters to.
3. **Filter tabs.** **Active (n)** and **Completed (n)** with live counts. Active = `in_progress` status; Completed = `completed` status. The screenshot shows **Active (1)** and **Completed (0)**.
4. **Survey card.** Title (`Walkover Survey`), visit pill (`Visit 1/1` — position within the visit chain), date (`10 May 2026`), status tag (`In Progress` in amber), notes icon if the survey has notes.
5. **Start New Survey button.** Pinned to the bottom; opens the survey type picker.

**Your task on this screen.**
- Switch tabs to find the survey you want to resume or review.
- Tap a card to open the survey form.
- Tap **Start New Survey** to add a fresh survey for this site.

> **Important:** The visit pill (`Visit 1/1`) shows your position in a chain of repeat visits at the same site — not a global counter. A site with two visits always reads "1/2, 2/2"; standalone surveys with no chain hide the pill entirely.

> **Note:** The list refreshes every time you focus the screen, so a visit added from the Add Visit screen appears without a manual pull-to-refresh.

> **Recommendation:** Keep surveys in `Active` while you are still capturing data. Move them to `Completed` only when you are confident no more visits are needed.

▎ Cross-platform note: Same `surveys` table as the web Step 4 Field Survey tab. Edits made on mobile sync back to the web row.

---

## 10. Walkover Survey — Survey Form (Offline)

**Screenshot:** `IMG_0277.PNG`

The survey form for a walkover survey. The dark `Offline` banner at the top tells you the phone is currently disconnected — the form behaves identically online or offline.

**Layout overview:**
1. **Offline banner.** Dark grey strip with the cloud-off icon and `Offline` label. Appears whenever NetInfo reports no network.
2. **Methodology card.** Soft-green info panel. For Walkover: *"Walk the entire site systematically. Record all habitat types using Fossitt Level 3 codes. Note all signs of protected and invasive species."* The text is pulled from the survey template, so different survey types show different guidance.
3. **Surveyor dropdown.** Defaults to you (`Dulra Balta` here) but can be re-pointed to a teammate — useful when one phone records for the whole team.
4. **Photos block.** `Photos (1)`. Camera icon launches the in-app camera; image icon opens the gallery picker. A hint reads `1 saved photos — visible when online` when offline.
5. **Weather Conditions section.** Expandable accordion with `Temperature *` (°C), `Wind Speed *` (km/h), `Wind Direction *` and any other fields the template defines. Red asterisks mark required fields.
6. **Save Progress button (left, outline).** Saves as `in_progress` so you can come back to it.
7. **Complete Survey button (right, solid green).** Saves as `completed`.

**Your task on this screen.**
- Confirm the surveyor is correct.
- Capture photos as you walk — each is watermarked with timestamp and GPS automatically.
- Fill the template fields. Required fields are marked with a red star.
- Tap **Save Progress** to keep going later, or **Complete Survey** when you are finished.

> **Important:** Photos taken while offline are queued locally with their EXIF and GPS. They upload to Supabase Storage the moment the phone is back online — do **not** delete the local copy in your camera roll until you confirm sync.

> **Note:** The `Photos (1)` count includes both pending (queued) and saved photos.

> **Recommendation:** Save Progress at least once before leaving a site, even if you plan to complete the survey later in the car. That commits everything to the local SQLite database so you cannot lose it on an app restart.

---

## 11. Walkover Survey — "Saved Offline" Confirmation

**Screenshot:** `IMG_0278.PNG`

The native alert that appears after you save (or complete) a survey while offline. The pending counter in the top banner has ticked up to `Offline · 1 pending`.

**Layout overview:**
1. **Pending counter (top banner).** `Offline · 1 pending`. The number is the count of unsynced survey rows plus queued photos.
2. **Native alert.** Title `Saved Offline`, message `Data saved locally. It will sync when you're back online.`
3. **OK button.** Dismisses the alert. There is no "Try sync now" option here — sync is automatic on reconnect.

**Your task on this screen.**
- Read the message so you know the save succeeded.
- Tap **OK** and keep working. There is nothing else to do.

> **Important:** "Saved Offline" is **not** an error. Your data is durable on the device's SQLite database the moment this alert appears. The app retries sync automatically when the phone comes back online or when it transitions from background to foreground.

> **Note:** The same alert appears for habitat saves, target note saves, photo uploads and visit creations — every write path falls back to the local queue identically.

> **Recommendation:** When you return to coverage, leave the app open in the foreground for a few seconds so the sync indicator can flush the queue. Backgrounding before the queue drains is safe, it just delays the upload until the app is foregrounded again.

---

## 12. Surveys — "Syncing…" After Reconnect

**Screenshot:** `IMG_0279.PNG`

The same survey list after the phone reconnects to the internet. The top banner has flipped from offline-grey to Dulra-green and shows `Syncing…` with a spinner. Once it completes, the pending count drops to zero and the banner disappears.

**Layout overview:**
1. **Sync banner (green, top).** Spinner + `Syncing…`. Auto-triggered on offline→online transitions and on app foregrounding.
2. **Survey list (empty).** The single survey that was active above is now `Completed (0)` on the active tab because completion was synced too.
3. **Start New Survey button.** Same as before — always available at the bottom.

**Your task on this screen.**
- Wait until the banner disappears or shows zero pending.
- If you tap the banner while it shows `n pending — tap to sync`, you can force a sync manually.

> **Note:** The mobile app runs one sync at a time. Surveys flush first, then photos that reference them — that ordering is enforced so photo rows always have a valid `survey_id` before they upload.

> **Important:** Once the banner clears, your data is in Supabase and visible on the web app for everyone on the project. There is no separate "publish" step from mobile.

▎ Cross-platform note: Synced surveys appear in the web Step 4 Field Survey tab. Photos are reachable from the same survey card on the web.

---

## 13. Habitats — Auto-imported Polygons

**Screenshot:** `IMG_0280.PNG`

The habitats list for the project, scoped by site if you came in from the site dropdown. By default the list shows every habitat within 100 m of the project (or site) boundary so heavy projects do not pull thousands of rows into the phone.

**Layout overview:**
1. **Banner.** `61 habitats near boundary` and the hint `Showing within 100 m of the project boundary.`
2. **Show all button (green pill).** Fetches every habitat for the project, server-capped at 1000 rows. After tapping, the button hides for the rest of the session.
3. **Habitat cards.** FOSSITT code badge (`GA1`, `GS4`, `PB1`) coloured by FOSSITT palette, habitat name (`Improved agricultural grassland`, `Wet grassland`, `Raised bog`), area in hectares (`294.94 ha`), and the source note `Auto-imported from Data Gathering (NLC)` when the polygon came from the NLC import step.
4. **Tap target.** The whole card opens the habitat detail screen.

**Your task on this screen.**
- Skim for the habitat you are checking in the field. Tap to open and review species notes, condition and EU Annex code.
- Tap **Show all** if you specifically need habitats that fall outside the 100 m buffer.
- Pull down to refresh. That re-fetches the bbox window and resets the **Show all** guard.

> **Important:** Habitat creation and editing happens on the web — mobile is read-only for the polygon geometry. Use **Target Notes** if you need to flag an issue with a habitat while you are on site.

> **Note:** `Unclassified` (grey) appears for habitats whose FOSSITT code is missing. The code is set on the web during Field Survey review.

> **Recommendation:** Open the habitats list once over Wi-Fi before driving out so the rows are cached. The 100 m bbox keeps the cache size manageable; **Show all** is the escape hatch when you need full coverage.

▎ Cross-platform note: Mirrors the web's Habitat panel. The polygons painted on the map (Survey Layers → Habitats) come from this same dataset.

---

## 14. Target Notes — List

**Screenshot:** `IMG_0281.PNG`

The target notes list for the project. Target notes are point-based observations — a sighting, a feature that needs to be checked, an invasive species patch — captured against a GPS location.

**Layout overview:**
1. **Back button.** Returns to the project detail screen.
2. **Note cards.** Title (`test notes`, `test notes 2`, `test notes 3`), category badge (`Check Feature` purple, `Flora` green) and priority badge (`Normal` grey, `High` red, `Low` blue).
3. **Verified check icon.** A green tick appears in the card header if a project manager has marked the note as verified.

**Your task on this screen.**
- Tap a card to open the note. The detail screen shows the photo, description, category, priority and the GPS coordinates.
- Use category badges to spot what kind of follow-up the note needs — `Check Feature` for things a teammate must verify, `Flora` for a plant record, etc.

> **Note:** New target notes are created from the project map (long-press to drop a pin) or from the project detail screen depending on your build. The list view here is read-and-review only.

> **Important:** Notes flagged `High` priority drive the PM's punch list back on the web. Use the priority field deliberately — don't mark routine observations as High.

> **Recommendation:** Photograph what you see *before* writing the description. Photos in target notes are watermarked with timestamp and GPS, which makes the description shorter and the record auditable.

---

## 15. Photos — Site Photo Grid

**Screenshot:** `IMG_0282.PNG`

The general site-photo grid for the project (or the selected site). These are photos that are *not* attached to a specific survey, habitat or target note — overview shots, access photos, signage, etc.

**Layout overview:**
1. **Back button and "Photos" title.** Standard navigation header.
2. **Site dropdown.** `EP 00001` here. Switches the grid to a different site's photos, or `All Sites` to see every general photo on the project.
3. **Photo thumbnails.** Square grid. The text overlaid on a thumbnail (`Site`) is the caption you typed when the photo was uploaded.
4. **Camera FAB (green, bottom-right).** Launches the in-app camera. After capture you are asked for an optional caption before upload.

**Your task on this screen.**
- Tap a thumbnail to open the full-screen viewer (next section).
- Tap the green FAB to capture a new general photo.
- Add a short caption when prompted — that is the text you see on the thumbnail.

> **Important:** General photos are scoped to a site on multi-site projects. Pick the site from the dropdown before tapping the camera FAB, otherwise the app prompts you to choose one.

> **Note:** Long-press a thumbnail (or open the viewer and tap the trash) to delete a photo. Deletes remove the Supabase row and the storage object.

> **Recommendation:** Use the in-app camera rather than the system camera + gallery upload. The in-app camera writes the GPS watermark directly into the saved image — gallery uploads still tag the row but the burned-in watermark only happens when the app takes the picture.

---

## 16. Photo Viewer — Watermarked Image

**Screenshot:** `IMG_0283.PNG`

The full-screen photo viewer. Used for general photos, survey photos, habitat photos and target-note photos — same component for all four.

**Layout overview:**
1. **Page counter (top-left).** `1/1` here. Updates as you swipe through the saved photos for the current parent record.
2. **Close button (top-right, white X).** Returns to the grid.
3. **Image canvas.** Pinch to zoom up to 5×; swipe horizontally between photos. Tap the image to centre it.
4. **Watermark footer.** Burned into the image at capture time, not a UI overlay. Format: `dd Month yyyy at HH:mm  ·  lat N, lng E  ·  Project name`. Example: `11.May 2026 at 08:54 · 41.00922N, 29.07851E · Ecologist Project`.

**Your task on this screen.**
- Swipe to flip through photos.
- Pinch to inspect detail.
- Tap **X** to close.

> **Important:** The watermark is part of the image file. If you download the photo from the web, the watermark is still there — that is what makes the photo defensible evidence in an ecological report.

> **Note:** The watermark generator runs in a hidden WebView mounted at app startup. If it fails (rare), the photo still uploads but without the burned-in text — the row's `taken_at` and `location` still carry the same data so the record is not lost.

> **Platform note:** On iOS, photos open in the system viewer if you save them from the share sheet. The watermark is visible in both viewers; the in-app viewer just disables marketing overlays and adds the page counter.

---

## 17. Settings — Profile & Location Permission

**Screenshot:** `IMG_0284.PNG`

The Settings tab with the Location permission modal open. Shows your account, your role, the current location-permission state and the sign-out action.

**Layout overview:**
1. **Profile card (behind the modal).** Initials avatar (`DB`), full name (`Dulra Balta`), email (`dulra@gmail.com`) and a role badge below.
2. **Permissions section.** A `Location` row that opens this modal. The status pill on the right reads `Granted`, `Denied` or `Not asked`.
3. **Location modal (foreground).** Green tick illustration, title `Location Enabled`, body *"Dulra has access to your location. GPS data will be recorded with new surveys and photos automatically."*, **Done** button.
4. **Account section (below).** A red `Sign Out` row.
5. **Tab bar.** `Projects` and `Settings`. `Settings` is the active tab here.

**Your task on this screen.**
- Tap **Location** under Permissions to see your current status. If denied, the modal switches to **Open Settings** to send you to iOS/Android system settings.
- Tap **Done** to dismiss the modal.
- Tap **Sign Out** at the bottom only when you are finished with the project — signing out drops the cached session and forces the next user to re-authenticate.

> **Important:** Without **Granted** location permission, surveys and photos save with no GPS coordinates. The save still succeeds, but you lose the location data that makes the record defensible.

> **Note:** The version string at the bottom (`Dulra Mobile v1.0.0`) helps support identify the build you are running when you report a bug.

> **Recommendation:** Keep the app signed in across days. Signing out clears your offline cache — the next sign-in has to re-download projects, habitats and surveys over the network.

▎ Cross-platform note: Your profile and role are managed on the web. The mobile Settings tab is read-only for everything except sign-out and device permissions.

---

## Quick Reference

| Action | Where | How |
|---|---|---|
| Sign in | Launch screen | Email + Password → **Sign In** |
| Open a project | Projects tab | Tap card |
| Pick a site | Project detail, surveys, photos | Site dropdown (`EP 00001`) |
| Open the full map | Project detail | Tap **Open map** pill on the preview |
| Switch base map | Map screen | **Layers** FAB → pick Streets/Satellite/Hybrid/Topographic |
| Show habitat polygons | Map screen | **Layers** → Survey Layers → **Habitats** |
| See NLC parcels | Map screen at z16+ | **Layers** → Survey Layers → **NLC reference** |
| Start a new survey | Project detail or Surveys list | **Start New Survey** → pick template |
| Save mid-survey | Survey form | **Save Progress** |
| Finish a survey | Survey form | **Complete Survey** |
| Force a sync | Top banner | Tap when it reads `n pending — tap to sync` |
| Review habitats | Project detail → Habitats | Tap card; **Show all** for full project |
| Add a general photo | Project detail → Photos | Green camera FAB → optional caption |
| Check GPS permission | Settings tab | **Location** row |

## Common Pitfalls

- **Starting a survey without picking a site on a multi-site project.** The **Start New Survey** button is greyed out with a yellow warning until you pick a site — do not try to work around it; the survey would save with no site link.
- **Closing the app immediately after a save while offline.** Save Progress writes to SQLite synchronously, but photos in flight need a second or two. Leave the app open for ~5 seconds after a save to be safe.
- **Backgrounding the app before the green `Syncing…` banner clears.** Sync is robust and will resume on next foreground, but if you need the data on the web *now*, wait for the banner to disappear.
- **Expecting habitat polygons to be editable.** Mobile is read-only for habitat geometry. Use **Target Notes** to flag changes — the web does the actual edit during Field Survey review.
- **Forgetting to grant location permission.** The app will not nag again after you tap "Maybe later." If your photos and surveys are missing GPS, check Settings → Location.
- **Using gallery uploads instead of the in-app camera.** Gallery uploads still tag the record with GPS, but the burned-in watermark only happens with the in-app camera. Use the in-app camera whenever you need the watermark visible in the image.
- **Mistaking `Saved Offline` for an error.** It is not — the data is durable in SQLite. The app will sync it automatically.
- **Aquatic features hiding your habitats.** Aquatic is mutually exclusive with Habitats and NLC. If habitats vanish from the map, check the **Layers** sheet — Aquatic is probably on.

## Next Section

Once your field data is synced, head back to the web app to continue with **Step 5: Data Review** — the synced surveys, habitats, target notes and photos appear in the project's Field Survey tab ready for review and reporting.
