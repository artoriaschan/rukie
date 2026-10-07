import type { DOMElement } from './dom.js'
import type { TextStyles } from './styles.js'
import { getGraphemeSegmenter } from './utils/intl.js'

/**
 * A segment of text with its associated styles.
 * Used for structured rendering without ANSI string transforms.
 */
export type StyledSegment = {
  text: string
  styles: TextStyles
  hyperlink?: string
}

/**
 * Squash text nodes into styled segments, propagating styles down through the tree.
 * This allows structured styling without relying on ANSI string transforms.
 * @param node - the subtree root whose text nodes are collected.
 * @param inheritedStyles - styles inherited from ancestors, merged with the node's own.
 * @param inheritedHyperlink - the hyperlink inherited from ancestor ink-link elements.
 * @param out - the array segments are appended to; defaults to a fresh array.
 * @returns `out` containing one segment per non-empty text node.
 */
export function squashTextNodesToSegments(
  node: DOMElement,
  inheritedStyles: TextStyles = {},
  inheritedHyperlink?: string,
  out: StyledSegment[] = [],
): StyledSegment[] {
  const mergedStyles = node.textStyles
    ? { ...inheritedStyles, ...node.textStyles }
    : inheritedStyles

  for (const childNode of node.childNodes) {
    if (childNode === undefined) {
      continue
    }

    if (childNode.nodeName === '#text') {
      if (childNode.nodeValue.length > 0) {
        // One terminal glyph has one style owner. Join a cluster across
        // inline span boundaries before ANSI tokenization can discard its
        // isolated combining marks or split a ZWJ sequence.
        let text = childNode.nodeValue
        const previous = out[out.length - 1]
        if (previous !== undefined) {
          const segmenter = getGraphemeSegmenter()
          const tail = segmenter.segment(previous.text).containing(previous.text.length - 1)?.segment
          if (tail !== undefined) {
            const head = segmenter.segment(tail + text)[Symbol.iterator]().next().value?.segment
            if (head !== undefined && head.length > tail.length) {
              const continuation = head.slice(tail.length)
              previous.text += continuation
              text = text.slice(continuation.length)
            }
          }
        }
        if (text.length > 0) out.push({
          text,
          styles: mergedStyles,
          hyperlink: inheritedHyperlink,
        })
      }
    } else if (
      childNode.nodeName === 'ink-text' ||
      childNode.nodeName === 'ink-virtual-text'
    ) {
      squashTextNodesToSegments(
        childNode,
        mergedStyles,
        inheritedHyperlink,
        out,
      )
    } else if (childNode.nodeName === 'ink-link') {
      const href = childNode.attributes['href'] as string | undefined
      squashTextNodesToSegments(
        childNode,
        mergedStyles,
        href || inheritedHyperlink,
        out,
      )
    }
  }

  return out
}

/**
 * Squash text nodes into a plain string (without styles).
 * Used for text measurement in layout calculations.
 * @param node - the subtree root whose text nodes are concatenated.
 * @returns the concatenated text content of every text node in the subtree.
 */
function squashTextNodes(node: DOMElement): string {
  let text = ''

  for (const childNode of node.childNodes) {
    if (childNode === undefined) {
      continue
    }

    if (childNode.nodeName === '#text') {
      text += childNode.nodeValue
    } else if (
      childNode.nodeName === 'ink-text' ||
      childNode.nodeName === 'ink-virtual-text'
    ) {
      text += squashTextNodes(childNode)
    } else if (childNode.nodeName === 'ink-link') {
      text += squashTextNodes(childNode)
    }
  }

  return text
}

export default squashTextNodes
