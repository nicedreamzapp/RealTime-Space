# Body Control: fly RealTime Space with your body (side project)

Status: idea and plan, nothing built yet. Started 2026-10-19.

## The idea

Stand the phone up, point its camera at yourself, put the picture on a TV (AirPlay), and fly the
ship with your body instead of the on-screen joystick. Lean to turn, reach forward to thrust, open
your arms to brake, pull your hands apart to zoom. It grew out of Star Blaster in Body Play
(our phone-as-camera motion games), where steering through space with your hands felt great.

## Why it fits this app

The flight model already has a clean input seam in `ios/NavigationPhysics.js`, the same calls the
joystick and buttons use:

- `setRotationInput(vector)` for turning (yaw, pitch, roll, -1..1)
- `setThrust(bool)` and `setBoost(bool)` for going forward
- `brake(dt)` and `emergencyStop()` for slowing down

So body control is just another input source feeding those calls. Physics, smoothing and
momentum stay exactly as they are.

## Proposed controls (all relative to how you stood when you started, no calibration screen)

| Body | Ship |
|---|---|
| Lean or step left / right | Turn left / right (yaw) |
| Both hands raised / lowered | Nose up / down (pitch) |
| Tilt your shoulders | Roll |
| Push both hands toward the phone | Thrust (harder push = more) |
| Arms wide open | Brake |
| Hands apart / together | Zoom out / in |
| Hold both hands up for a moment | Pause and show the menu |

Nothing moves the ship unless the camera clearly sees head, shoulders and both hands
(the rule Body Play uses so a person walking past doesn't fly the ship).

## How to build it

1. **Tracking, on device and offline:** Apple Vision `VNDetectHumanBodyPoseRequest` on the back
   ultra-wide camera (0.5x, so a whole person fits in a normal room). Android: MediaPipe Pose.
   No network, no recording, nothing leaves the phone.
2. **Bridge:** Swift sends the 2D joints to the web view each frame (`WorkingPortalWebView` /
   `GalaxyBridge` already pass messages), as `{ head, lShoulder, rShoulder, lHand, rHand, lHip, rHip }`
   in 0..1 picture coordinates.
3. **`BodyControl.js`** (new): One Euro smoothing, the gestures above, a dead zone around the
   starting pose, and the calls into `NavigationPhysics`. A small see-through figure in a corner
   of the HUD shows what the camera sees.
4. **Mode switch:** a "Body Control" toggle in the menu; turning it on opens the camera and shows
   "Stand the phone up, step back until I can see you".
5. **TV:** AirPlay mirror the app so the phone can stay on its stand.

## Open questions

- Phone on a stand with the picture on a TV, or a second screen required? (A phone on a stand
  is too small to watch from 6 feet away.)
- Front camera (see yourself on the phone) vs. back ultra-wide (better tracking, needs a TV).
- Does this stay a free feature or part of the unlock?
