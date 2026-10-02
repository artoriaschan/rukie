import type { BoxProps, TextProps } from "../components";
import { lineWidth, textLines, type TextSpan, type TextStyle } from "../text";
import { Node, Direction, Edge, FlexDirection, Gutter, MeasureMode } from "../yoga";

export type HostType = "tui-box" | "tui-text" | "tui-static";
export type HostProps = BoxProps & TextProps & { input?: boolean; cursorOffset?: number };

export interface HostNode {
  type: HostType | "raw";
  props: HostProps;
  text: string;
  children: HostNode[];
  parent?: HostNode;
  yoga: Node;
}

export interface LayoutNode {
  type: HostType;
  props: HostProps;
  spans: TextSpan[];
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
    bold: node.props.bold ?? inherited.bold,
    dimColor: node.props.dimColor ?? inherited.dimColor,
    inverse: node.props.inverse ?? inherited.inverse,
    italic: node.props.italic ?? inherited.italic,
  };
  return node.children.flatMap((child) => content(child, style));
}

function dirty(node: HostNode) {
  for (let current: HostNode | undefined = node; current; current = current.parent) {
    current.yoga.markDirty();
  }
}

export function createNode(type: HostNode["type"], props: HostProps = {}, text = ""): HostNode {
  const node: HostNode = { type, props, text, children: [], yoga: new Node() };
  updateNode(node, props);
  if (type === "tui-text") {
    node.yoga.setMeasureFunc((width, widthMode) => {
      const columns =
        widthMode === MeasureMode.Undefined ? Infinity : Math.max(0, Math.floor(width));
      const lines = textLines(
        content(node),
        columns,
        node.props.wrap !== "truncate",
        node.props.input,
      );
      return { width: Math.max(0, ...lines.map(lineWidth)), height: lines.length };
    });
  }
  return node;
}

export function updateNode(node: HostNode, props: HostProps) {
  node.props = props;
  const yoga = node.yoga;
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
  if (parent.type === "tui-box" && child.type !== "tui-static") parent.yoga.removeChild(child.yoga);
  child.parent = undefined;
  dirty(parent);
}

export function insertNode(parent: HostNode, child: HostNode, before?: HostNode) {
  if (child.parent) removeNode(child.parent, child);
  const index = before ? parent.children.indexOf(before) : parent.children.length;
  parent.children.splice(index, 0, child);
  child.parent = parent;
  if (parent.type === "tui-box" && child.type !== "tui-static") {
    const yogaIndex = parent.children
      .slice(0, index)
      .filter((node) => node.type !== "tui-static").length;
    parent.yoga.insertChild(child.yoga, yogaIndex);
  }
  dirty(parent);
}

export function calculateTree(root: HostNode, columns: number): LayoutNode {
  root.yoga.setWidth(columns);
  root.yoga.calculateLayout(columns, undefined, Direction.LTR);
  function snapshot(node: HostNode, x = 0, y = 0): LayoutNode {
    x += Math.round(node.yoga.getComputedLeft());
    y += Math.round(node.yoga.getComputedTop());
    return {
      type: node.type === "tui-text" ? "tui-text" : "tui-box",
      props: node.props,
      spans: node.type === "tui-text" ? content(node) : [],
      x,
      y,
      width: Math.round(node.yoga.getComputedWidth()),
      height: Math.round(node.yoga.getComputedHeight()),
      children:
        node.type === "tui-box"
          ? node.children
              .filter((child) => child.type !== "tui-static")
              .map((child) => snapshot(child, x, y))
          : [],
    };
  }
  return snapshot(root);
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
