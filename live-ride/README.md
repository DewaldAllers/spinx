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
- **Projector** — From the instructor dashboard choose **Open studio display** and **Fullscreen**. Mirror the tablet using the studio’s existing connection. For a projector attached to a separate device, use the projector link under **Share class and display links**. On the tablet, **Instructor controls** opens the controls directly over the board.

## Try a race

1. Create a **Demo** class and choose **Add 10 demo riders**, or have people join and move the demo effort slider.
2. Select a duration and choose **Start race**. SpinX balances the two teams by rider count and gives them a three-second countdown.
3. Both teams score average pedal revolutions per rider. The roster stays fixed for the round. Late arrivals can join the next race.
4. The instructor can send reactions to rider screens and the projector.

## Phone cadence pilot

Create a **Phone motion** class and have each rider tap **Enable phone motion** with their phone mounted securely and flat. The browser estimates RPM from repeated acceleration patterns on the phone and sends only the RPM estimate to SpinX. Keep the browser open while riding. Test steady speeds against a bike console or cadence sensor before using phone motion to score a class. Mounts, bikes and phones can produce different results. Demo RPM is available in a separate class mode.

The creating browser holds a private class-control token. Riders join under a display name, which is shown to the class. Class hosting is open to people who can reach the service, so use a studio-controlled environment for the pilot.
