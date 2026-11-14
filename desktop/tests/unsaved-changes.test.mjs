import assert from "node:assert/strict";
import { test } from "node:test";
import { protectUnsavedChanges } from "../src/renderer/unsaved-changes.ts";

function windowStub() {
  const listeners = new Set();
  return {
    listeners,
    addEventListener(name, listener) {
      assert.equal(name, "beforeunload");
      listeners.add(listener);
    },
    removeEventListener(name, listener) {
      assert.equal(name, "beforeunload");
      listeners.delete(listener);
    },
  };
}

test("clean rules never register an exit blocker", () => {
  const target = windowStub();
  const dispose = protectUnsavedChanges(target, false);
  assert.equal(target.listeners.size, 0);
  dispose();
});

test("dirty rules prevent unload; saving or unmounting removes the blocker", () => {
  const target = windowStub();
  const dispose = protectUnsavedChanges(target, true);
  assert.equal(target.listeners.size, 1);
  let prevented = false;
  const event = {
    returnValue: undefined,
    preventDefault() {
      prevented = true;
    },
  };
  for (const listener of target.listeners) listener(event);
  assert.equal(prevented, true);
  assert.equal(event.returnValue, "");
  dispose();
  assert.equal(target.listeners.size, 0);
  protectUnsavedChanges(target, false)();
  assert.equal(target.listeners.size, 0);
});
