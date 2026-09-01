// Test suite for the co-edge point-label splay fix (ir/geometry-ir.ts's
// edgeLabelSplayLocal, mirrored in ui/FormNode.tsx's edgeLabelSplay). Runs
// under Vitest:
//
//   npm test
//
// Regression target: the discriminated-union triangle's base (shape
// 'triangle', rotation 270, both points on edge 'c') where 'Article' and
// 'Tutorial' sit ~58px apart on screen and, pre-fix, their labels collided
// (both anchored 'east', growing the SAME direction from nearly-adjacent
// anchor points). Post-fix, each point's label is nudged an extra fixed
// distance along the edge's own tangent — split apart instead of stacked.

import { describe, expect, it } from 'vitest'
import { buildDrawCmds, formCenterPx, pointPositionsPx, type DrawCmd } from '../../components/editor/ir/geometry-ir'
import { diagramToTikzCore } from '../../components/editor/export/tikz'
import { diagramToHtmlCore } from '../../components/editor/export/html'
import type { Diagram } from '../../components/editor/domain/types'

// A crude, DOM-free width estimate over the label's VISIBLE glyphs — same
// spirit as ir/geometry-ir.ts's own "no DOM measurement" rule. Point names
// in this suite use `\mathtt{...}` (as the real discriminated-union diagram
// does); strip that wrapper so the estimate reflects what KaTeX actually
// renders (e.g. "Article", not the literal 16-char LaTeX source).
const CHAR_W = 9
function visibleText(rawName: string): string {
  const m = /^\\mathtt\{(.*)\}$/.exec(rawName)
  return m ? m[1] : rawName
}
function estimatedWidth(rawName: string): number {
  return visibleText(rawName).length * CHAR_W
}

// The label's horizontal on-screen extent, given its anchor (TikZ
// convention: 'east' = text's east edge at `at`, so it extends WEST;
// 'west' extends EAST; 'north'/'south' center horizontally on `at`) and an
// estimated width. Mirrors export/html.ts's own labelHalfExtents split.
function xRange(at: number, anchor: Extract<DrawCmd, { kind: 'label' }>['anchor'], width: number): [number, number] {
  if (anchor === 'east') return [at - width, at]
  if (anchor === 'west') return [at, at + width]
  return [at - width / 2, at + width / 2] // north/south (or unset) — centered
}

function disjoint(a: [number, number], b: [number, number]): boolean {
  return a[1] <= b[0] || b[1] <= a[0]
}

function findLabel(cmds: DrawCmd[], needle: string): Extract<DrawCmd, { kind: 'label' }> {
  const found = cmds.find((c) => c.kind === 'label' && c.text.includes(needle))
  if (!found || found.kind !== 'label') throw new Error(`no label command containing "${needle}"`)
  return found
}

describe('co-edge point-label splay', () => {
  // The exact ticket scenario: a rotation-270 triangle's base (edge 'c'),
  // two named points, both on the SAME edge.
  const triangleBase: Diagram = {
    schemaVersion: 1,
    forms: [{
      id: 'T1',
      shape: 'triangle',
      position: { x: 0, y: 0 },
      rotation: 270,
      edges: { a: [], b: [], c: ['P_ART', 'P_TUT'], peak: [] },
    }],
    points: {
      P_ART: { id: 'P_ART', shape: 'empty', name: '\\mathtt{Article}', formId: 'T1', edgeKey: 'c' },
      P_TUT: { id: 'P_TUT', shape: 'empty', name: '\\mathtt{Tutorial}', formId: 'T1', edgeKey: 'c' },
    },
    lines: [],
  }

  it("two same-edge labels ('Article'/'Tutorial' on the rotated triangle base) produce DISJOINT estimated x-ranges", () => {
    const cmds = buildDrawCmds(triangleBase)
    const artLbl = findLabel(cmds, 'Article')
    const tutLbl = findLabel(cmds, 'Tutorial')

    // Sanity: this is really the crowding scenario — both points sit on the
    // same edge, close together (the ticket's ~58px), with the SAME anchor
    // direction (both grow the same way) — the pre-fix collision case.
    // The shared anchor is 'north' (label hangs BELOW its point): at rotation
    // 270 the base's form-local Left faces screen-DOWN, and a label always
    // sits outside the body. This used to read 'east' because the anchor was
    // taken from the UNROTATED cardinal — the bug where a rotated form's
    // labels stayed pinned to the side they'd have had at rotation 0.
    const pos = pointPositionsPx(triangleBase)
    const artPos = pos.get('P_ART')!.pos
    const tutPos = pos.get('P_TUT')!.pos
    expect(Math.abs(tutPos.x - artPos.x), 'the two points are close together on screen (the reported ~58px case)').toBeLessThan(70)
    expect(artLbl.anchor, "both labels share the SAME growth anchor ('north' — the base faces screen-down at rotation 270)").toBe('north')
    expect(tutLbl.anchor).toBe('north')

    const artRange = xRange(artLbl.at.x, artLbl.anchor, estimatedWidth('\\mathtt{Article}'))
    const tutRange = xRange(tutLbl.at.x, tutLbl.anchor, estimatedWidth('\\mathtt{Tutorial}'))
    expect(
      disjoint(artRange, tutRange),
      `expected disjoint x-ranges, got Article=[${artRange}] Tutorial=[${tutRange}]`,
    ).toBe(true)
  })

  it('a single-point edge label is UNCHANGED (no splay bias for a lone point)', () => {
    const d: Diagram = {
      schemaVersion: 1,
      forms: [{ id: 'S1', shape: 'square', position: { x: 0, y: 0 }, edges: { top: ['P1'], right: [], bottom: [], left: [] } }],
      points: { P1: { id: 'P1', shape: 'empty', name: 'x', formId: 'S1', edgeKey: 'top' } },
      lines: [],
    }
    const pos = pointPositionsPx(d).get('P1')!.pos
    const lbl = findLabel(buildDrawCmds(d), 'x')
    // Pre-splay formula: cardinal 'top' -> offset (0, -LABEL_GAP_V_PX=11),
    // anchor 'south' — with count=1 the splay bias is exactly {0,0}, so this
    // must land exactly where the un-splayed formula always has.
    expect(lbl.anchor, "lone top-edge point keeps anchor 'south' (unchanged)").toBe('south')
    expect(lbl.at.x, 'lone point label x is UNCHANGED (no horizontal splay)').toBeCloseTo(pos.x, 6)
    expect(lbl.at.y, 'lone point label y is UNCHANGED (still point.y - 11)').toBeCloseTo(pos.y - 11, 6)
  })

  it('the exact-centre point of an odd-count edge also gets zero bias', () => {
    const d: Diagram = {
      schemaVersion: 1,
      forms: [{ id: 'S2', shape: 'square', position: { x: 0, y: 0 }, edges: { top: ['L', 'M', 'R'], right: [], bottom: [], left: [] } }],
      points: {
        L: { id: 'L', shape: 'empty', name: 'left', formId: 'S2', edgeKey: 'top' },
        M: { id: 'M', shape: 'empty', name: 'mid', formId: 'S2', edgeKey: 'top' },
        R: { id: 'R', shape: 'empty', name: 'right', formId: 'S2', edgeKey: 'top' },
      },
      lines: [],
    }
    const pos = pointPositionsPx(d).get('M')!.pos
    const midLbl = findLabel(buildDrawCmds(d), 'mid')
    expect(midLbl.at.x, 'the middle of 3 same-edge points is unbiased horizontally').toBeCloseTo(pos.x, 6)
    expect(midLbl.at.y, 'the middle of 3 same-edge points keeps its normal vertical offset').toBeCloseTo(pos.y - 11, 6)

    // Its two siblings, in contrast, DO get pushed apart (both grow south
    // -- 'top' cardinal centers horizontally already, so the pre-fix
    // baseline wouldn't have collided here; this just confirms the bias
    // itself fires with opposite signs for the outer two).
    const leftLbl = findLabel(buildDrawCmds(d), 'left')
    const rightLbl = findLabel(buildDrawCmds(d), 'right')
    expect(leftLbl.at.x, 'the earlier sibling is nudged one way').not.toBeCloseTo(pos.x, 1)
    expect(rightLbl.at.x, 'the later sibling is nudged the other way').not.toBeCloseTo(pos.x, 1)
    expect(Math.sign(leftLbl.at.x - pos.x), 'the two outer siblings are nudged in OPPOSITE directions').toBe(-Math.sign(rightLbl.at.x - pos.x))
  })

  it('sanity: TikZ export for the 2-point triangle base still emits BOTH point labels', () => {
    const tikz = diagramToTikzCore(triangleBase)
    expect(tikz, 'TikZ output contains the Article label').toContain('\\mathtt{Article}')
    expect(tikz, 'TikZ output contains the Tutorial label').toContain('\\mathtt{Tutorial}')
  })

  it('no splay on an unrotated VERTICAL edge — labels keep their plain horizontal offset', () => {
    // three points on a square's left edge (unrotated): labels extend left and
    // stack vertically, so they must NOT be splayed along the edge (the bug).
    const d: Diagram = {
      schemaVersion: 1,
      forms: [{ id: 'F', shape: 'square', position: { x: 0, y: 0 }, edges: { top: [], right: [], bottom: [], left: ['a', 'b', 'c'] } }],
      points: {
        a: { id: 'a', shape: 'empty', formId: 'F', edgeKey: 'left', name: 'x' },
        b: { id: 'b', shape: 'empty', formId: 'F', edgeKey: 'left', name: 'y' },
        c: { id: 'c', shape: 'empty', formId: 'F', edgeKey: 'left', name: 'z' },
      },
      lines: [],
    }
    const pos = pointPositionsPx(d)
    const cmds = buildDrawCmds(d)
    for (const nm of ['x', 'y', 'z']) {
      const id = nm === 'x' ? 'a' : nm === 'y' ? 'b' : 'c'
      const lbl = findLabel(cmds, nm)
      // left-cardinal label: at.y must equal the point's own y (no vertical splay)
      expect(lbl.at.y, `left-edge label ${nm} keeps its point's y (no vertical splay)`).toBeCloseTo(pos.get(id)!.pos.y, 6)
    }
  })

  // Regression: "any label should turn with the form and always stay OUTSIDE
  // it". The apex always worked (its label read the same cardinal either way);
  // the BASE points broke, because the anchor/offset were taken from the
  // unrotated cardinal while the point itself had rotated away. Checked as a
  // geometric invariant (label further from the body centroid than its own
  // point) rather than by asserting cardinals per angle, so it holds for every
  // shape and rotation rather than restating the formula.
  it('point labels stay OUTSIDE the body at every rotation, on every shape', () => {
    for (const shape of ['triangle', 'square', 'rhombus', 'circle'] as const) {
      const edgeKey = shape === 'triangle' ? 'c' : shape === 'rhombus' ? 'top-left' : 'left'
      for (const rotation of [0, 90, 180, 270]) {
        const d: Diagram = {
          schemaVersion: 1,
          forms: [{ id: 'F', shape, position: { x: 0, y: 0 }, rotation, edges: { [edgeKey]: ['P1', 'P2'] } }],
          points: {
            P1: { id: 'P1', shape: 'empty', name: 'a', formId: 'F', edgeKey },
            P2: { id: 'P2', shape: 'empty', name: 'b', formId: 'F', edgeKey },
          },
          lines: [],
        }
        const center = formCenterPx(d.forms[0])
        const pos = pointPositionsPx(d)
        const cmds = buildDrawCmds(d)
        for (const [pid, nm] of [['P1', 'a'], ['P2', 'b']] as const) {
          const p = pos.get(pid)!.pos
          const lbl = findLabel(cmds, `$${nm}$`)
          const dPoint = Math.hypot(p.x - center.x, p.y - center.y)
          const dLabel = Math.hypot(lbl.at.x - center.x, lbl.at.y - center.y)
          expect(
            dLabel,
            `${shape}@${rotation}° point ${pid}: label must sit further out than its point (got label ${dLabel.toFixed(1)} vs point ${dPoint.toFixed(1)})`,
          ).toBeGreaterThan(dPoint)
        }
      }
    }
  })

  it('sanity: HTML/SVG export for the 2-point triangle base still emits BOTH point labels', () => {
    const svg = diagramToHtmlCore(triangleBase)
    expect(svg, 'SVG output contains the Article label text').toContain('Article')
    expect(svg, 'SVG output contains the Tutorial label text').toContain('Tutorial')
  })
})
