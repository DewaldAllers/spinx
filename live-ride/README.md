# SpinX Live

SpinX Live runs instructor-led cycling races and the projector scoreboard. It has its own server and class codes.

## Run locally

Use Node.js 22.12 or newer. From this directory:

```sh
npm ci
npm run build
npm start
```

Open http://localhost:8787 on the host computer. For a demo on other devices on the same Wi-Fi, use the computer's LAN address and port 8787. The network and Windows firewall must allow devices to reach that port.

## Studio setup

Serve the app at the root of an HTTPS origin. Run the Node server behind an HTTPS reverse proxy and forward both HTTP requests and WebSocket upgrades at `/ws`. Keep one server instance for a class. Active rooms live in memory and end if the server restarts.

- **Instructor** — The instructor creates the class on the device they’ll use to run it. That browser can start races, post to class comments, send reactions and end the class. Enable **My cadence** to show the instructor’s RPM separately on the rider and projector screens.
- **Rider phones** — Open the rider link or enter the class code. On iPhone, Safari’s **Add to Home Screen** can open SpinX as a web app. Android browsers can offer a home-screen install or shortcut. The join link also works for riders who stay in their browser.
- **Projector** — Open the projector link from **Share rider and projector links**. The display shows live cadence alongside the race. Double-click or press **F** to request fullscreen in supported browsers. If the projector mirrors the tablet, leave the tablet on the projector view and use another device to host and control the class.
- **Android install** — Open the HTTPS site in Chrome and choose **Install SpinX** if offered, or use Chrome’s **Add to Home screen** menu. Launch from the home screen to use the app without the browser address bar.

On the rider screen, the cadence gauge shows your current RPM and pace, your peak for this open ride, and the average cadence of the other riders with live readings. **Riders** lists who is connected. **Comments** shares short messages with riders and the instructor. The cheer buttons send an emoji to the class.

Each class has eight rider places and one separate instructor place. In a demo class, riders can join first and the instructor can fill the remaining places with simulated riders.

## Try a race

1. Create a **Demo** class. Riders can join and move the demo effort slider, or you can fill the available places with demo riders. Simulated riders pedal at 100–150 RPM during games.
2. In **Games**, select **Team race**, pick a duration, and choose **Start race**. SpinX shuffles riders into two teams of nearly equal size. It avoids replaying the same matchup back to back when the roster allows it. Riders see their team during the three-second countdown.
3. Both teams score average pedal turns per rider. One turn is one full pedal revolution. The scoreboard also shows current team RPM during the race. The roster stays fixed for the round. Late arrivals can join the next race if places are available.
4. The 3D velodrome follows the cyclists around a banked track and through the finish. The 30-second, 1-minute and 2-minute races cover 3, 5 and 9 virtual laps. The race clock moves the scene towards the finish, the scores determine the gap, and live cadence drives the pedalling. The 2D race remains available on devices without WebGL 2 and when reduced motion is enabled. At the timed finish, the winner crosses first, or both cross together on a tie. The result stays on screen for eight seconds before the projector returns to the rider board and phones return to cadence. The instructor can still open **Last race**.
5. Choose **End class** and confirm to close the join code and stop cadence updates.

## Try Orbit Defense

In **Games**, choose **Orbit Defense**, select **Easy**, **Medium**, or **Hard**, and start a round with at least one connected rider. Higher levels send faster, denser waves and give the class fewer shields. On Hard, each wave opens with a pair of drones.

The riders share a ship. Their average live cadence sets its firing capacity, and the ship only fires when it can hit a drone. A drone that gets through costs one shield. Keep at least one shield until time runs out to win. The projector shows the game alongside live cadence, and rider phones show the round timer and score.

## Phone cadence pilot

Create a **Phone motion** class and have each rider open the HTTPS link in their main browser, with the phone mounted securely, flat and pointing forward. Tap **Enable phone motion** and grant access if prompted.

- **Checking sensors** means SpinX is waiting for the first motion events.
- **Finding pedal rhythm** means the browser is receiving data and waiting for a repeating pedal pattern. It resumes automatically after a pause, pace change, or movement that obscures the signal.
- **Cadence detected** means the rider's phone has estimated a stable RPM. The instructor roster shows the same status.
- **Last reading · finding rhythm** on the instructor roster means SpinX is holding the last measured RPM during a pace change or weak signal. The rider sees the cadence display. Held values do not add to the race score.
- **Stopped** displays 0 RPM after about 3.5 seconds of continuous stillness in the phone readings.
- **No sensor data** means motion events did not arrive. Check site permissions and keep the class page visible.

The phone checks for a new estimate about three times per second, starting with the last 2.65 seconds of data and looking farther back only when needed. Slower cadence takes longer to observe because there are fewer pedal revolutions per second. Only the RPM estimate and signal status go to SpinX. Raw sensor readings stay on the phone. Motion access is permission to read the sensors. It cannot prove that a movement came from pedaling, and vibration, harmonics and phone mounts can affect results. Compare a sprint, recovery, and stop against a bike console or crank sensor before using this mode to score a live class. Demo RPM is available in a separate class mode.

Background reading on [Motosumo’s cadence measurement](https://support.motosumo.com/en/articles/2298521-measuring-your-cadence), [mount positioning](https://support.motosumo.com/en/articles/2298483-positioning-your-phone-on-the-bike) and [browser motion permissions](https://www.w3.org/TR/orientation-event/).

The creating browser holds a private class-control token. Riders join under a display name, which is shown to the class. Class hosting is open to people who can reach the service, so use a studio-controlled environment for the pilot.

## Dashboard artwork

`public/velodrome.jpg` was created with the built-in ImageGen tool. The race itself is drawn and animated from the server scores.

> Create a photorealistic editorial sports photograph for the background of an original indoor cycling studio control dashboard. Extremely wide cinematic 2.4:1 composition. An empty indoor velodrome, low camera angle at the straightaway looking across the smooth curved timber track, strong rightward sweep and vanishing point on the right, cool graphite atmosphere, selective lime-yellow overhead tube lighting, subtle black and bronze shadows, hard arena spotlight on right, refined premium sports campaign photography. The left 45 percent should be substantially dark with simple negative space for a white HTML title. On the right show a clear sense of speed using track lines and parallel light streaks. No cyclists, no people, no bikes, no typography or logos or interface. Rich photographic detail and controlled contrast.
