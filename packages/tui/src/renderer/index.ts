import { createContext, type ReactNode } from "react";
import Reconciler from "react-reconciler";
import { ConcurrentRoot, DefaultEventPriority, NoEventPriority } from "react-reconciler/constants";
import type { Readable } from "node:stream";
import {
  calculateTree,
  createNode,
  insertNode,
  removeNode,
  updateNode,
  updateText,
  type HostNode,
  type HostProps,
  type HostType,
} from "../layout";
import { fullFrame } from "../screen";

export interface RenderOptions {
  stdin: Readable;
  stdout: { columns: number; rows: number; write(text: string): unknown };
}

interface Container {
  tree: HostNode;
  options: RenderOptions;
  active: boolean;
}

let priority = NoEventPriority;
const noop = () => {};
const reconciler = Reconciler({
  rendererVersion: "0.1.0",
  rendererPackageName: "@neant/tui",
  extraDevToolsConfig: null,
  isPrimaryRenderer: true,
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  getRootHostContext: () => ({}),
  getChildHostContext: (context: object) => context,
  getPublicInstance: (node: HostNode) => node,
  prepareForCommit: () => null,
  resetAfterCommit: (container: Container) => {
    if (!container.active) return;
    const { stdout } = container.options;
    stdout.write(
      fullFrame(calculateTree(container.tree, stdout.columns), stdout.columns, stdout.rows),
    );
  },
  createInstance: (type: HostType, props: HostProps) => createNode(type, props),
  createTextInstance: (text: string) => createNode("raw", {}, text),
  appendInitialChild: insertNode,
  appendChild: insertNode,
  insertBefore: insertNode,
  removeChild: removeNode,
  appendChildToContainer: (container: Container, child: HostNode) =>
    insertNode(container.tree, child),
  insertInContainerBefore: (container: Container, child: HostNode, before: HostNode) =>
    insertNode(container.tree, child, before),
  removeChildFromContainer: (container: Container, child: HostNode) =>
    removeNode(container.tree, child),
  clearContainer: (container: Container) => {
    // Removing a node mutates this array, so iterate a snapshot.
    // oxlint-disable-next-line unicorn/no-useless-spread
    for (const child of [...container.tree.children]) removeNode(container.tree, child);
  },
  finalizeInitialChildren: () => false,
  shouldSetTextContent: () => false,
  commitUpdate: (node: HostNode, _type: HostType, _old: HostProps, props: HostProps) =>
    updateNode(node, props),
  commitTextUpdate: (node: HostNode, _old: string, text: string) => updateText(node, text),
  preparePortalMount: noop,
  getInstanceFromNode: () => null,
  beforeActiveInstanceBlur: noop,
  afterActiveInstanceBlur: noop,
  prepareScopeUpdate: noop,
  getInstanceFromScope: () => null,
  detachDeletedInstance: noop,
  scheduleTimeout: setTimeout,
  cancelTimeout: clearTimeout,
  noTimeout: -1,
  supportsMicrotasks: true,
  scheduleMicrotask: queueMicrotask,
  getCurrentUpdatePriority: () => priority,
  setCurrentUpdatePriority: (value: number) => {
    priority = value;
  },
  resolveUpdatePriority: () => priority || DefaultEventPriority,
  shouldAttemptEagerTransition: () => false,
  trackSchedulerEvent: noop,
  resolveEventType: () => null,
  resolveEventTimeStamp: () => performance.now(),
  maySuspendCommit: () => false,
  maySuspendCommitOnUpdate: () => false,
  maySuspendCommitInSyncRender: () => false,
  preloadInstance: () => true,
  startSuspendingCommit: noop,
  suspendInstance: noop,
  suspendOnActiveViewTransition: noop,
  waitForCommitToBeReady: () => null,
  getSuspendedCommitReason: () => null,
  NotPendingTransition: null,
  // React creates these private context fields at runtime; its public types omit them.
  HostTransitionContext: createContext(null) as unknown as Reconciler.ReactContext<null>,
  resetFormInstance: noop,
  requestPostPaintCallback: (callback: (time: number) => void) => callback(performance.now()),
  bindToConsole: (_method: string, args: unknown[]) => () => console.log(...args),
});

/** Mount synchronously; subsequent React state updates paint on each commit. */
export function render(element: ReactNode, options: RenderOptions) {
  const container: Container = {
    tree: createNode("tui-box", { flexDirection: "column" }),
    options,
    active: true,
  };
  const exit = Promise.withResolvers<void>();
  const fail = (error: Error) => {
    throw error;
  };
  const root = reconciler.createContainer(
    container,
    ConcurrentRoot,
    null,
    false,
    null,
    "",
    fail,
    fail,
    fail,
    noop,
    null,
  );
  reconciler.updateContainerSync(element, root, null, null);
  reconciler.flushSyncWork();
  return {
    unmount() {
      if (!container.active) return;
      container.active = false;
      reconciler.updateContainerSync(null, root, null, null);
      reconciler.flushSyncWork();
      exit.resolve();
    },
    waitUntilExit: () => exit.promise,
  };
}
