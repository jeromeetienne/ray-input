import EventEmitter from 'eventemitter3'
import InteractionModes from './ray-interaction-modes'
import {isMobile} from './util'

const DRAG_DISTANCE_PX = 10;

/**
 * Enumerates all possible interaction modes. Sets up all event handlers (mouse,
 * touch, etc), interfaces with gamepad API.
 *
 * Emits events:
 *    action: Input is activated (mousedown, touchstart, daydream click, vive
 *    trigger).
 *    release: Input is deactivated (mouseup, touchend, daydream release, vive
 *    release).
 *    cancel: Input is canceled (eg. we scrolled instead of tapping on
 *    mobile/desktop).
 *    pointermove(2D position): The pointer is moved (mouse or touch).
 */
export default class RayController extends EventEmitter {
  constructor(renderer) {
    super();
    this.renderer = renderer;

    this.availableInteractions = {};

    // Handle interactions.
    window.addEventListener('mousedown', this.onMouseDown_.bind(this));
    window.addEventListener('mousemove', this.onMouseMove_.bind(this));
    window.addEventListener('mouseup', this.onMouseUp_.bind(this));
    window.addEventListener('touchstart', this.onTouchStart_.bind(this));
    window.addEventListener('touchmove', this.onTouchMove_.bind(this));
    window.addEventListener('touchend', this.onTouchEnd_.bind(this));

    // The position of the pointer.
    this.pointer = new THREE.Vector2();
    // The previous position of the pointer.
    this.lastPointer = new THREE.Vector2();
    // Position of pointer in Normalized Device Coordinates (NDC).
    this.pointerNdc = new THREE.Vector2();
    // How much we have dragged (if we are dragging).
    this.dragDistance = 0;
    // Are we dragging or not.
    this.isDragging = false;

    // Gamepad events.
    this.gamepad = null;
    window.addEventListener('gamepadconnected', this.onGamepadConnected_.bind(this));

    // VR Events.
    if (!navigator.getVRDisplays) {
      console.warn('WebVR API not available! Consider using the webvr-polyfill.');
    } else {
      navigator.getVRDisplays().then((displays) => {
        this.vrDisplay = displays[0];
      });
    }
    window.addEventListener('vrdisplaypresentchange', this.onVRDisplayPresentChange_.bind(this));
  }

  getInteractionMode() {
    // TODO: Debugging only.
    //return InteractionModes.DAYDREAM;

    var gamepad = this.getVRGamepad_();

    if (gamepad) {
      // If there's a gamepad connected, determine if it's Daydream or a Vive.
      if (gamepad.id == 'Daydream Controller') {
        return InteractionModes.DAYDREAM;
      }

      // TODO: Verify the actual ID.
      if (gamepad.id == 'Vive Controller') {
        return InteractionModes.VIVE;
      }

    } else {
      // If there's no gamepad, it might be Cardboard, magic window or desktop.
      if (isMobile()) {
        // Either Cardboard or magic window, depending on whether we are
        // presenting.
        if (this.vrDisplay && this.vrDisplay.isPresenting) {
          return InteractionModes.CARDBOARD;
        } else {
          return InteractionModes.TOUCH;
        }
      } else {
        // We must be on desktop.
        return InteractionModes.MOUSE;
      }
    }
    // By default, use TOUCH.
    return InteractionModes.TOUCH;
  }

  getGamepadPose() {
    var gamepad = this.getVRGamepad_();
    return gamepad.pose;
  }

  setSize(size) {
    this.size = size;
  }

  update() {
    if (this.getInteractionMode() == InteractionModes.DAYDREAM) {
      // If we're dealing with a gamepad, check every animation frame for a
      // pressed action.
      let isGamepadPressed = this.getGamepadButtonPressed_();
      if (isGamepadPressed && !this.wasGamepadPressed) {
        this.emit('action');
      }
      if (!isGamepadPressed && this.wasGamepadPressed) {
        this.emit('release');
      }
      this.wasGamepadPressed = isGamepadPressed;
    }
  }

  getGamepadButtonPressed_() {
    var gamepad = this.getVRGamepad_();
    if (!gamepad) {
      // If there's no gamepad, the button was not pressed.
      return false;
    }
    // Check for clicks.
    for (var j = 0; j < gamepad.buttons.length; ++j) {
      if (gamepad.buttons[j].pressed) {
        return true;
      }
    }
    return false;
  }

  onMouseDown_(e) {
    this.startDragging_(e);
    this.emit('action');
  }

  onMouseMove_(e) {
    this.updatePointer_(e);
    this.updateDragDistance_();

    this.emit('pointermove', this.pointerNdc);
  }

  onMouseUp_(e) {
    this.endDragging_();
  }

  onTouchStart_(e) {
    var t = e.touches[0];
    this.startDragging_(t);
    this.updateTouchPointer_(e);

    this.emit('pointermove', this.pointerNdc);
    this.emit('action');
  }

  onTouchMove_(e) {
    this.updateTouchPointer_(e);
    this.updateDragDistance_();
  }

  onTouchEnd_(e) {
    this.endDragging_();
  }

  updateTouchPointer_(e) {
    // If there's no touches array, ignore.
    if (e.touches.length === 0) {
      console.warn('Received touch event with no touches.');
      return;
    }
    var t = e.touches[0];
    this.updatePointer_(t);
  }

  updatePointer_(e) {
    // How much the pointer moved.
    this.pointer.set(e.clientX, e.clientY);
    this.pointerNdc.x = (e.clientX / this.size.width) * 2 - 1;
    this.pointerNdc.y = - (e.clientY / this.size.height) * 2 + 1;
  }

  updateDragDistance_() {
    if (this.isDragging) {
      var distance = this.lastPointer.sub(this.pointer).length();
      this.dragDistance += distance;
      this.lastPointer.copy(this.pointer);


      console.log('dragDistance', this.dragDistance);
      if (this.dragDistance > DRAG_DISTANCE_PX) {
        this.emit('cancel');
        this.isDragging = false;
      }
    }
  }

  startDragging_(e) {
    this.isDragging = true;
    this.lastPointer.set(e.clientX, e.clientY);
  }

  endDragging_() {
    if (this.dragDistance < DRAG_DISTANCE_PX) {
      this.emit('release');
    }
    this.dragDistance = 0;
    this.isDragging = false;
  }

  onGamepadConnected_(e) {
    var gamepad = navigator.getGamepads()[e.gamepad.index];
    // TODO: Only care about gamepads that support motion control.
  }

  onVRDisplayPresentChange_(e) {
    console.log('onVRDisplayPresentChange_', e);
  }

  /**
   * Gets the first VR-enabled gamepad.
   */
  getVRGamepad_() {
    var gamepads = navigator.getGamepads();
    for (var i = 0; i < gamepads.length; ++i) {
      var gamepad = gamepads[i];

      // The array may contain undefined gamepads, so check for that as well as
      // a non-null pose.
      if (gamepad && gamepad.pose) {
        return gamepad;
      }
    }
    return null;
  }
}