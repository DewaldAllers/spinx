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

- **Android tablet** — Open the HTTPS site in Chrome and choose **Install SpinX** if offered, or use Chrome’s **Add to Home screen** menu. Launch from the home screen to use the app without the browser address bar.
- **Rider phones** — Open the class link or enter the class code. On iPhone, Safari’s **Add to Home Screen** can open SpinX as a web app. Android browsers can offer a home-screen install or shortcut. The join link also works for riders who stay in their browser.
- **Projector** — Choose **Open projector view** and **Fullscreen**. This is the audience screen. Copy the projector link under **Share rider and projector links** to open it on a separate device while you keep the instructor dashboard on the tablet. If you mirror the tablet, **Instructor controls** opens the controls directly over the board.

On the rider screen, the cadence gauge shows your current RPM and pace, your peak for this open ride, and the average cadence of the other riders with live readings. **Riders** lists who is connected. **Comments** shares short messages with riders and the instructor. The cheer buttons send an emoji to the class.

## Try a race

1. Create a **Demo** class and choose **Add 10 demo riders**, or have people join and move the demo effort slider.
2. Select a duration and choose **Start race**. SpinX shuffles riders into two teams of nearly equal size. It avoids replaying the same matchup back to back when the roster allows it. Riders see their team during the three-second countdown.
3. Both teams score average pedal revolutions per rider. The roster stays fixed for the round. Late arrivals can join the next race.
4. The projector shows two animated cyclists whose positions follow the live scores. At the finish, the winner crosses first, or both cross together on a tie. The result stays on screen for eight seconds before the projector returns to the rider board and phones return to cadence. The instructor can still open **Last race**.
5. Choose **End class** and confirm to close the join code and stop cadence updates.

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
