import { createContext, createElement, type ReactNode } from "react";
import Reconciler from "react-reconciler";
import { ConcurrentRoot, DefaultEventPriority, NoEventPriority } from "react-reconciler/constants";
import { createTerminalSession, TerminalContext, type TerminalIO } from "../terminal";
import {
  calculateTree,
  calculateStaticTree,
  createNode,
  insertNode,
  removeNode,
  updateNode,
  updateText,
  type HostNode,
  type HostProps,
  type HostType,
  type LayoutNode,
} from "../layout";
import { createScreen } from "../screen";
import { ClockProvider } from "../hooks/animation-frame";
import { createGraphics } from "../graphics";
import { createSelection } from "../selection";
import { createHover } from "./hover";

export interface RenderOptions extends TerminalIO {
  fullscreen?: boolean;
}

interface Container {
  tree: HostNode;
  options: RenderOptions;
  active: boolean;
  screen: ReturnType<typeof createScreen>;
  hover: ReturnType<typeof createHover>;
  selection: ReturnType<typeof createSelection>;
  graphics: ReturnType<typeof createGraphics>;
  graphicsState(): ReturnType<ReturnType<typeof createTerminalSession>["getGraphics"]>;
  completed: WeakSet<HostNode>;
  pending: LayoutNode[];
  timer?: ReturnType<typeof setTimeout>;
  error?: unknown;
  onError(error: unknown): void;
}

function paint(container: Container) {
  if (!container.active) return;
  const { stdout } = container.options;
  try {
    const layout = calculateTree(
      container.tree,
      stdout.columns,
      container.options.fullscreen ? stdout.rows : undefined,
    );
    stdout.write(container.screen(layout, stdout.columns, stdout.rows, container.pending));
    container.graphics.paint(layout, stdout.columns, stdout.rows, container.graphicsState());
    container.hover.record(layout, stdout.columns, stdout.rows);
    container.pending = [];
  } catch (error) {
    container.onError(error);
  }
}

function schedulePaint(container: Container) {
  container.timer ??= setTimeout(() => {
    container.timer = undefined;
    paint(container);
  }, 16);
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
    function collect(node: HostNode) {
      if (node.type === "tui-static") {
        for (const child of node.children) {
          if (container.completed.has(child)) continue;
          container.pending.push(calculateStaticTree(child, stdout.columns));
          container.completed.add(child);
        }
      } else {
        node.children.forEach(collect);
      }
    }
    collect(container.tree);
    schedulePaint(container);
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

/** Mount synchronously; later commits coalesce into at most one frame every 16ms. */
export function render(element: ReactNode, options: RenderOptions) {
  const selection = createSelection(() => schedulePaint(container));
  const container: Container = {
    tree: createNode("tui-box", { flexDirection: "column" }),
    options,
    active: true,
    screen: createScreen(options.fullscreen, selection),
    selection,
    hover: createHover(),
    graphics: createGraphics((text) => options.stdout.write(text)),
    graphicsState: () => terminal.getGraphics(),
    completed: new WeakSet(),
    pending: [],
    onError(error) {
      container.error = error;
      terminal.dispose();
    },
  };
  const exit = Promise.withResolvers<void>();
  // Startup errors are thrown synchronously; retain the rejection for waitUntilExit callers.
  void exit.promise.catch(noop);
  const terminal = createTerminalSession(
    options,
    () => {
      if (!container.active) return;
      container.hover.clear();
      selection.clear();
      container.screen.invalidate();
      schedulePaint(container);
    },
    () => {
      container.active = false;
      selection.dispose();
      container.graphics.clear();
      clearTimeout(container.timer);
      container.pending = [];
      if (container.error !== undefined) exit.reject(container.error);
      else exit.resolve();
    },
    // Controlled editors must see parent resets before decoding the next key.
    // ANSI output remains coalesced by schedulePaint, including during a paste.
    (notify) => reconciler.flushSyncFromReconciler(notify),
    options.fullscreen,
  );
  terminal.subscribeInput((event) => {
    if (event.type === "move") {
      if (event.button === 0 && selection.move(event.x, event.y)) container.hover.cancelPress();
      container.hover.move(event.x, event.y);
    } else if (event.type === "mouse") {
      if (event.button === 0 && event.action === "press") selection.press(event.x, event.y);
      if (event.button === 0 && event.action === "release" && selection.release())
        container.hover.cancelPress();
      container.hover[event.action](event.x, event.y, event.button);
    } else if (event.type === "wheel") {
      selection.clear();
      container.hover.cancelPress();
      container.hover.wheel(event);
    } else if (event.type === "focus" && !event.focused) {
      selection.clear();
      container.hover.cancelPress();
    } else if (event.type === "key" && selection.hasSelection()) {
      selection.clear();
      container.hover.cancelPress();
      if (event.key.name === "escape") event.handled = true;
    }
  });
  const fail = container.onError;
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
  try {
    reconciler.updateContainerSync(
      createElement(
        TerminalContext.Provider,
        { value: terminal },
        createElement(ClockProvider, null, element),
      ),
      root,
      null,
      null,
    );
    reconciler.flushSyncWork();
    clearTimeout(container.timer);
    container.timer = undefined;
    paint(container);
    if (container.error !== undefined) throw container.error;
  } catch (error) {
    terminal.dispose();
    reconciler.updateContainerSync(null, root, null, null);
    reconciler.flushSyncWork();
    throw error;
  }
  let unmounted = false;
  return {
    unmount() {
      if (unmounted) return;
      unmounted = true;
      container.active = false;
      selection.dispose();
      clearTimeout(container.timer);
      container.pending = [];
      try {
        reconciler.updateContainerSync(null, root, null, null);
        reconciler.flushSyncWork();
      } finally {
        terminal.dispose();
      }
    },
    waitUntilExit: () => exit.promise,
  };
}
