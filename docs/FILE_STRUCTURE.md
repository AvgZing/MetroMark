The file structure for MetroMark needs to be very logical, and files need to be broken down more to avoid overburdened files when unnecessary. Instead of a basic layered structure, we'll split into a feature-based structure. Throughout all of this work, there may be additional subfolders necessary depending on the files that currently exist, and additional subfolders may be necessary for when a given script gets broken down into other smaller ones. Generally I like individual files to be shorter, more function-by-function (in a nested folder if multiple files with functions are grouped) rather than large thousands-of-lines-long files with tons of functions. When reorganizing the project to follow this organization, do it in two steps: Move first, refactor second (First, create the folders and move some of the files into the new folders and fix the import/require paths first to make sure the app still runs. Then, Once the structure is stable, take split/rewrite the functions, including updating my md docs and ensuring consistency in variables and redundant code eliminated and ideal functionality exists for everything to best align with my restructuring plan.). Anyway, I'll break my new proposed structure into a few main components:

Root directory (no folder:)
- License, README, .gitignore (for github purposes)
- package.json and package-lock.json (for npm purposes)
- index.html (for pages purposes and error avoidance purposest)
- .env files (4 files - the example and real for both prod and dev; because these can't be moved. gitignore the real env files but not the example ones)

node_modules: Folder required and created by npm (gitignored)
- not sync'd to github, can be deleted and recreated by npm easily on any machine

operations: Folder for entirely non-critical files, just helpful for me/other devs
- No files in this folder should be required for MetroMark to run; these are noncritical, optional files for maintainers of MetroMark/other developers to be able to save files or logs
- powershell scripts (convert to .bat files instead) - for opening specific pages, running the site, or other administrative tasks that i may have to do every now and again (not gitignored, so make sure this doesn't contain information specific to my system)
- sql scripts for my supabase and for my postgres: each one has an ongoing baseline file that's use for initial setup and gets updated regularly, and a changes/changelog file that has new changes dated along with any commands necessary to run for migration. the intent is that an existing database would look at the changes file and run any changes as they happen, but a new database could just run the baseline
- any documentation .md files (currently there are a lot, keep any that may still be in use, but by the time we publish this, there should be only quite few: operations guide, variables, workspace layout, and architecture; all of these md files should be kept updated regularly)
- Logs: Subfolder for log files because I want to add this for tracking things; elements of this will also be visible on the admin dashboard but this will be the archiving way of handling when users are active, requests made/failed, etc etc. (gitignored)
- Backups: Subfolder for any backups that are made -- if necessary; I don't see any need for backups at this point. (gitignored)

public: Folder for frontend files. 
- Nothing in here should directly talk to the database or filesystem directly; for that, it needs to query Server endpoints.
- Styles: Subfolder for all styles, broken apart instead of one massive styles.css
    - base.css (global variables)
    - map.css (styles for the map UI and route displays on there where it isn't pulling from base.css)
    - lineview.css (styles for the line view UI where it isn't pulling from base.css)
    - admin.css (styles for management views like override pages or admin dashboards, where it's not pulling from base.css)
- Scripts: Subfolder for actual functionality on the frontend 
    - These are frontend only (ie: don't interface with the database or filesystem) and will call on services in the /server folder as needed
    - Examples may be a date formatter or coordinate convertor, or in future perhaps this will include a localization script, or something for a carousel on a future homepage.
    - UI: Nested folder for all shared, site-wide UI scripting (for example, if light/dark mode toggle or custom scrollbar were done with js, those would be files here; remembering that light/dark mode wouldn't in itself set user preference in supabase but would tell/request the backend to do so as part of the universal user preference script on the backend)
    - Map: Nested folder for all map-related logic including line and stop rendering/fetch logic. Multiple js files will be broken out within here.
    - Sidebar: Nested folder for all sidebar-related logic, with multiple js files, including scripts, search, toggles, visibility overrides, filters, etc.
    - Admin: Nested folder for any admin-related logic, like dashboard display js or override frontend js before it hits the backend.
- Assets: Subfolder for Images, icons, fonts
    - Self explanatory purpose. Currently no assets but when logo or favicon gets added, it will go here.
- html files (in root of public folder, for now - including index, dashboard, override)

server: Folder for backend tasks and services.
- Nothing in here should directly talk to the user; for that, it needs to send data to the frontend files. But the server is allowed to query other server endpoints. Most of this folder is broken down into MODULES: Individual apps/services/modules that call upon one another.
- processors: Subfolder for Individual Postgres and Supabase read/write processers for other services to hook into. Also processors for any data requests: direct user or route data to appropriate database. For example, a routes request would check postgres for data on route geometry for a bounding box, and if unable to find that geometry, it would call on the data sources below. A user-data request or authentification file would direct to supabase as necessary.
- sources: Subfolder for Any files related to outside data sources and harvesting data for saving to postgres. Files should have nested folders based on the data source/provider; currently only Transitland but in future I will be adding Overpass for Hong Kong MTR/china subways and potentially other data sources. This is where my universal Transitland interfacer (it gets fed filter, bbox, etc. info and request info and sends those to transitland for downloading to my postgres) would be, as well as any future data sources. This is also where the recurring background harvester would go (it hasn't been updated in a while, but it would trigger a transitland harvest every so often for a defined bbox as defined by the admin dashboard where tasks can get queued, along with a fallback where major cities around the world are given city slugs and bboxes (translation layer) so if there's no queued bboxes then it would fall to collecting data for cities around the world. it would collect all data that's possibly used on the frontend including stop order and frequency and all types; and the harvester stops when it hits its limit on api calls). This is also where any data normalizers should go: for example, if we're grouping stops together BEFORE it gets saved, that would go here (any stop grouping AFTER saving would have to be on the front end so that would go out there). If the map provider has its own backend js files, then those should go in a subfolder here, but I believe it's all frontend so that doesn't need anything here. 
- admin: Subfolder for any files related to admin work. This is where admin dashboard, admin override, etc./similar. scripts would go. This is also where the env file config would go. Additionally, I want to add log files, this is where the processor for that would go. This is also where any schedulers would go: ie - when running production (not dev), the background harvester would need to be queued to run every so often, so this would go here. Likewise for backup script would need a scheduler, if we still need backups which I don't think we do.


Note: This structure must bear in mind the following expansion plans.
App idea: Exploration tracker. 
Minimum Viable Product: Display on a map and filter transit stops by line in global cities, and be able to mark completion of those stops along each route. Be able to set up an account for your tracking, be able to zoom out and see your progress on the lines in the world. Likely using supabase for accounts and data, maplibre for globe and 3d and simple baseline views, and transitland for the transit line and station information backend. Operate on a coordinate-based system for any points/info, so things can be set in radii to cluster stations, move them together, etc. similar to subway builder; add a manual override system for renaming or repositioning and keep a track of that so future updates from the API show that and re-merge. Include a Line View when clicking on lines for more familiar navigation.
Later features:
- To-Do Lists / High-level targeting (not just display/filtering, but tracking your goals)
- Automatic per-line display with progress bar on the route
- Add personal notes to stations 
- User-suggestion system for issues/feedback as you see it.
- More filtering options (by category/capacity, by operator, by line, by frequency!!) - so you can prioritize the "easy to explore" stations if it's most frequent. Frequency on weekends, nights, days, etc.
- More completion options (passed through, boarded/deboarded, explored station, explored area/spent time around)
- Fog of World-style (auto-tracking button for passed-through vs not with caching for low-data tunnels, show the area and lines more clearly on a map, maybe heatmap-style display. use hexagons - h3 indexing)
- Add custom routes (Route planning, like Google My Maps but temporary)
- Expand on notes: global notes, and personal notes anywhere on the map via pins (pins maybe concurrent with custom routes feature)
- Add notable places (user inspired? add pics to stations? expand on global notes from before? risk google maps overlap -- maybe this is architectural, like "cool building"?)