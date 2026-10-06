import type { BoxProps, TextProps, ImageProps } from "../components";
import {
  lineWidth,
  textCursor,
  textLines,
  type Glyph,
  type TextSpan,
  type TextStyle,
} from "../text";
import { Node, Direction, Edge, FlexDirection, Gutter, MeasureMode, PositionType } from "../yoga";
import type { ScrollState, ScrollAnchor } from "../scroll";

export type HostType = "tui-box" | "tui-text" | "tui-static" | "tui-scroll" | "tui-image";
export type HostProps = BoxProps &
  Partial<ImageProps> &
  TextProps & {
    input?: boolean;
    maxLines?: number;
    cursorOffset?: number;
    cursorStyle?: "block";
    atomicRanges?: readonly { start: number; end: number }[];
    scroll?: ScrollState;
  };

export interface HostNode {
  type: HostType | "raw";
  props: HostProps;
  text: string;
  children: HostNode[];
  parent?: HostNode;
  yoga: Node;
  contentYoga?: Node;
  textLayout?: { width: number; spans: TextSpan[]; lines: Glyph[][] };
  scrollContent?: { width: number; children: LayoutNode[] };
  inputTop?: number;
  initialized?: boolean;
}

export interface LayoutNode {
  source: HostNode;
  type: HostType;
  props: HostProps;
  spans: TextSpan[];
  lines?: Glyph[][];
  textTop?: number;
  x: number;
  y: number;
  width: number;
  height: number;
  children: LayoutNode[];
}

function content(node: HostNode, inherited: TextStyle = {}): TextSpan[] {
  if (node.type === "raw") return [{ text: node.text, style: inherited }];
  const style: TextStyle = {
    color: node.props.color ?? inherited.color,
    backgroundColor: node.props.backgroundColor ?? inherited.backgroundColor,
    bold: node.props.bold ?? inherited.bold,
    dimColor: node.props.dimColor ?? inherited.dimColor,
    inverse: node.props.inverse ?? inherited.inverse,
    italic: node.props.italic ?? inherited.italic,
    underline: node.props.underline ?? inherited.underline,
  };
  return node.children.flatMap((child) => content(child, style));
}

function dirty(node: HostNode) {
  for (let current: HostNode | undefined = node; current; current = current.parent) {
    current.yoga.markDirty();
    current.contentYoga?.markDirty();
    current.textLayout = undefined;
  }
}

function measuredText(node: HostNode, width: number) {
  if (node.textLayout?.width === width) return node.textLayout;
  const spans = node.textLayout?.spans ?? content(node);
  const lines = textLines(
    spans,
    width,
    node.props.wrap !== "truncate",
    node.props.input || node.props.preserveWhitespace,
    node.props.atomicRanges,
  );
  return (node.textLayout = { width, spans, lines });
}

export function createNode(type: HostNode["type"], props: HostProps = {}, text = ""): HostNode {
  const node: HostNode = { type, props: {}, text, children: [], yoga: new Node() };
  if (type === "tui-scroll") {
    node.contentYoga = new Node();
    node.contentYoga.setFlexDirection(FlexDirection.Column);
  }
  updateNode(node, props);
  if (type === "tui-text") {
    node.yoga.setMeasureFunc((width, widthMode) => {
      const columns =
        widthMode === MeasureMode.Undefined ? Infinity : Math.max(0, Math.floor(width));
      const { lines } = measuredText(node, columns);
      return {
        width: lines.reduce((max, line) => Math.max(max, lineWidth(line)), 0),
        height: Math.min(lines.length, node.props.maxLines ?? Infinity),
      };
    });
  }
  return node;
}

export function updateNode(node: HostNode, props: HostProps) {
  const keys = new Set([...Object.keys(node.props), ...Object.keys(props)]);
  if (
    node.initialized &&
    [...keys].every(
      (key) =>
        key === "children" || node.props[key as keyof HostProps] === props[key as keyof HostProps],
    )
  ) {
    node.props = props;
    return;
  }
  node.props = props;
  node.initialized = true;
  const yoga = node.yoga;
  yoga.setPositionType(
    props.position === "absolute" ? PositionType.Absolute : PositionType.Relative,
  );
  yoga.setPosition(Edge.Top, props.top);
  yoga.setPosition(Edge.Right, props.right);
  yoga.setPosition(Edge.Bottom, props.bottom);
  yoga.setPosition(Edge.Left, props.left);
  yoga.setFlexDirection(
    props.flexDirection === "column" ? FlexDirection.Column : FlexDirection.Row,
  );
  yoga.setWidth(props.width);
  yoga.setHeight(props.height);
  yoga.setFlexGrow(props.flexGrow ?? 0);
  yoga.setFlexShrink(props.flexShrink ?? 0);
  yoga.setPadding(Edge.Left, props.paddingLeft ?? props.paddingX ?? props.padding ?? 0);
  yoga.setPadding(Edge.Right, props.paddingRight ?? props.paddingX ?? props.padding ?? 0);
  yoga.setPadding(Edge.Top, props.paddingTop ?? props.paddingY ?? props.padding ?? 0);
  yoga.setPadding(Edge.Bottom, props.paddingBottom ?? props.paddingY ?? props.padding ?? 0);
  yoga.setMargin(Edge.Left, props.marginLeft ?? props.marginX ?? props.margin ?? 0);
  yoga.setMargin(Edge.Right, props.marginRight ?? props.marginX ?? props.margin ?? 0);
  yoga.setMargin(Edge.Top, props.marginTop ?? props.marginY ?? props.margin ?? 0);
  yoga.setMargin(Edge.Bottom, props.marginBottom ?? props.marginY ?? props.margin ?? 0);
  yoga.setGap(Gutter.All, props.gap ?? 0);
  yoga.setBorder(Edge.All, props.borderStyle ? 1 : 0);
  dirty(node);
}

export function updateText(node: HostNode, text: string) {
  node.text = text;
  dirty(node);
}

export function removeNode(parent: HostNode, child: HostNode) {
  parent.children.splice(parent.children.indexOf(child), 1);
  if ((parent.type === "tui-box" || parent.type === "tui-scroll") && child.type !== "tui-static")
    (parent.contentYoga ?? parent.yoga).removeChild(child.yoga);
  child.parent = undefined;
  dirty(parent);
}

export function insertNode(parent: HostNode, child: HostNode, before?: HostNode) {
  if (child.parent) removeNode(child.parent, child);
  const index = before ? parent.children.indexOf(before) : parent.children.length;
  parent.children.splice(index, 0, child);
  child.parent = parent;
  if ((parent.type === "tui-box" || parent.type === "tui-scroll") && child.type !== "tui-static") {
    const yogaIndex = parent.children
      .slice(0, index)
      .filter((node) => node.type !== "tui-static").length;
    (parent.contentYoga ?? parent.yoga).insertChild(child.yoga, yogaIndex);
  }
  dirty(parent);
}

export function calculateTree(root: HostNode, columns: number, rows?: number): LayoutNode {
  root.yoga.setWidth(columns);
  root.yoga.setHeight(rows);
  root.yoga.calculateLayout(columns, rows, Direction.LTR);
  function snapshot(node: HostNode, x = 0, y = 0): LayoutNode {
    x += Math.round(node.yoga.getComputedLeft());
    y += Math.round(node.yoga.getComputedTop());
    const width = Math.round(node.yoga.getComputedWidth());
    const height = Math.round(node.yoga.getComputedHeight());
    let offset = 0;
    let children: LayoutNode[] = [];
    if (node.contentYoga && node.props.scroll) {
      node.contentYoga.setWidth(width);
      node.contentYoga.calculateLayout(width, undefined, Direction.LTR);
      const local = node.children.map((child) => snapshot(child));
      const top = node.props.scroll.getSnapshot().top;
      const anchor =
        node.scrollContent && width !== node.scrollContent.width
          ? readingAnchor(node.scrollContent.children, top)
          : undefined;
      const restored = node.props.scroll.takeInitialAnchor();
      const anchoredTop = restored
        ? resolvePortableAnchor(local, restored)
        : anchor
          ? resolveAnchor(local, anchor)
          : undefined;
      offset = node.props.scroll.layout(
        { x, y, width, height, total: Math.round(node.contentYoga.getComputedHeight()) },
        anchoredTop,
      );
      node.props.scroll.setAnchor(portableAnchor(local, offset));
      node.scrollContent = { width, children: local };
      children = local.map((child) => translate(child, x, y - offset));
    } else if (node.type === "tui-box") {
      children = node.children
        .filter((child) => child.type !== "tui-static")
        .map((child) => snapshot(child, x, y));
    }
    const text = node.type === "tui-text" ? measuredText(node, width) : undefined;
    if (text && node.props.input && node.props.maxLines !== undefined) {
      const caret = textCursor(
        text.spans,
        width,
        node.props.cursorOffset ?? 0,
        node.props.atomicRanges,
      );
      const previousTop = node.inputTop ?? 0;
      node.inputTop = Math.max(
        0,
        Math.min(
          text.lines.length - height,
          caret.y < previousTop ? caret.y : Math.max(previousTop, caret.y - height + 1),
        ),
      );
    }
    return {
      source: node,
      type:
        node.type === "tui-text" || node.type === "tui-scroll" || node.type === "tui-image"
          ? node.type
          : "tui-box",
      props: node.props,
      spans: text?.spans ?? [],
      lines: text?.lines,
      textTop: node.inputTop,
      x,
      y,
      width,
      height,
      children,
    };
  }
  return snapshot(root);
}

function translate(node: LayoutNode, x: number, y: number): LayoutNode {
  return {
    ...node,
    x: node.x + x,
    y: node.y + y,
    children: node.children.map((child) => translate(child, x, y)),
  };
}

interface ReadingAnchor {
  source: HostNode;
  offset: number;
  inset: number;
}

function readingAnchor(nodes: LayoutNode[], top: number): ReadingAnchor | undefined {
  for (const node of nodes) {
    if (node.y + node.height <= top) continue;
    if (node.type === "tui-text") {
      const row = Math.max(0, top - node.y);
      if (!node.lines?.[row]) continue;
      return {
        source: node.source,
        offset: node.lines?.[row]?.[0]?.offset ?? 0,
        inset: Math.min(0, top - node.y),
      };
    }
    const anchor = readingAnchor(node.children, top);
    if (anchor) return anchor;
  }
  return undefined;
}

function resolveAnchor(nodes: LayoutNode[], anchor: ReadingAnchor): number | undefined {
  for (const node of nodes) {
    if (node.source === anchor.source) {
      const row =
        node.lines?.findLastIndex((line) => (line[0]?.offset ?? Infinity) <= anchor.offset) ?? 0;
      return node.y + Math.max(0, row) + anchor.inset;
    }
    const top = resolveAnchor(node.children, anchor);
    if (top !== undefined) return top;
  }
  return undefined;
}

/** Portable anchors use caller-provided identity, never rendered text matching. */
function portableAnchor(
  nodes: LayoutNode[],
  top: number,
  id?: string,
  path: number[] = [],
): ScrollAnchor | undefined {
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]!;
    if (node.y + node.height <= top) continue;
    const identity = node.props.scrollAnchorId ?? id;
    const nextPath = node.props.scrollAnchorId ? [] : [...path, index];
    if (node.type === "tui-text" && identity) {
      const row = Math.max(0, top - node.y);
      if (!node.lines?.[row]) continue;
      return {
        id: identity,
        path: nextPath,
        offset: node.lines?.[row]?.[0]?.offset ?? 0,
        inset: Math.min(0, top - node.y),
      };
    }
    const found = portableAnchor(node.children, top, identity, nextPath);
    if (found) return found;
  }
  return undefined;
}

function resolvePortableAnchor(nodes: LayoutNode[], anchor: ScrollAnchor): number | undefined {
  for (const node of nodes) {
    if (node.props.scrollAnchorId === anchor.id) {
      let target: LayoutNode | undefined = node;
      for (const index of anchor.path) target = target?.children[index];
      if (!target || target.type !== "tui-text") return undefined;
      const row =
        target.lines?.findLastIndex((line) => (line[0]?.offset ?? Infinity) <= anchor.offset) ?? 0;
      return target.y + Math.max(0, row) + anchor.inset;
    }
    const found = resolvePortableAnchor(node.children, anchor);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Measure a completed item in its own column, including its outer margins. */
export function calculateStaticTree(item: HostNode, columns: number): LayoutNode {
  const root = createNode("tui-box", { flexDirection: "column" });
  root.children.push(item);
  root.yoga.insertChild(item.yoga, 0);
  try {
    return calculateTree(root, columns);
  } finally {
    root.yoga.removeChild(item.yoga);
  }
}
