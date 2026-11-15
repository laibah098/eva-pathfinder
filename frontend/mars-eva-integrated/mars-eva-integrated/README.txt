MARS EVA PATHFINDER — INTEGRATED TEST BUILD

1. Extract the folder mars-eva-integrated into YOUR EXISTING eva-pathfinder/frontend/ folder.
2. Keep original frontend/index.html, script.js, style.css, frontend/images/*, frontend/mars3d/mars3d/terrain.json and backend/app.py unchanged.
3. Open a terminal in eva-pathfinder and run: python backend/app.py
4. Open a second terminal in eva-pathfinder/frontend and run: python -m http.server 8000
5. Visit: http://localhost:8000/mars-eva-integrated/

REQUIRES existing assets:
 frontend/images/mars-photo.png
 frontend/images/mars-height.png
 frontend/images/mars-thermal.png
 frontend/mars3d/mars3d/terrain.json (from your real NASA elevation TIFF)

The ZIP contains the globe texture. The original backend is not included or changed.
This is a test integration, not a verified production release.

Navigation: globe -> Open EVA planner -> Plan route -> choose a route -> Explore selected route in 3D -> Play POV.

FIXED: 2D imagery references ../images/ because existing images live in frontend/images.
You can open 3D directly at http://localhost:8000/mars-eva-integrated/terrain.html
