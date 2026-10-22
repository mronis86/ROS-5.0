# ROS PowerPoint Bridge (Windows)

Local helper that attaches to the running PowerPoint deck, uploads low-res slide stills to a ROS event, and reports the live Slideshow slide so the web app can load/start mapped cues.

## Use

1. Unzip the whole folder. Do not run `START.bat` from inside the zip window.
2. Open the deck in PowerPoint.
3. Run `START.bat` (or `ROS PowerPoint Bridge.exe` in the same folder).
4. Paste the Railway API URL and an integration token (`ros_itok_…`) with scopes `read,control,write`.
5. Load events, pick the show, click **Capture stills**.
6. In the ROS web app open **PowerPoint** from the Run of Show operator menu and map stills to cues.
7. Click **Start follow**, then start Slideshow. Advancing a mapped slide fires the mapped action.

Requires Windows and desktop PowerPoint. The helper never writes into the PPTX.
