import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../store/store';
import type { ID, MindMap, MindNode, MindNodeKind } from '../store/types';
import { uid } from '../lib/id';
import { sum } from '../lib/money';
import { goalStatus } from '../lib/projections';
import { Card, ConfirmButton, Field, MoneyInput, Progress, useToast } from '../components/ui';

const KIND_META: Record<MindNodeKind, { icon: string; label: string }> = {
  root: { icon: '◉', label: 'Centre' },
  goal: { icon: '◎', label: 'Goal' },
  idea: { icon: '💡', label: 'Idea' },
  question: { icon: '❓', label: 'Open question' },
  risk: { icon: '⚠️', label: 'Risk' },
  milestone: { icon: '🏁', label: 'Milestone' },
  money: { icon: '💵', label: 'Cost' },
};

interface Template {
  name: string;
  build: () => MindMap;
}

const templateMap = (name: string, spec: [string, MindNodeKind, string][][]): MindMap => {
  const rootId = uid('n');
  const nodes: MindNode[] = [
    { id: rootId, label: name, detail: '', kind: 'root', x: 640, y: 380 },
  ];
  const edges = [] as MindMap['edges'];
  const branches = spec.length;
  spec.forEach((branch, bi) => {
    const angle = (bi / branches) * Math.PI * 2 - Math.PI / 2;
    const [label, kind, detail] = branch[0];
    const bx = 640 + Math.cos(angle) * 300;
    const by = 380 + Math.sin(angle) * 210;
    const branchId = uid('n');
    nodes.push({ id: branchId, label, kind, detail, x: bx, y: by });
    edges.push({ id: uid('e'), from: rootId, to: branchId, label: '' });
    branch.slice(1).forEach((leaf, li) => {
      const spread = (li - (branch.length - 2) / 2) * 0.42;
      const lx = 640 + Math.cos(angle + spread) * 560;
      const ly = 380 + Math.sin(angle + spread) * 390;
      const leafId = uid('n');
      nodes.push({ id: leafId, label: leaf[0], kind: leaf[1], detail: leaf[2], x: lx, y: ly });
      edges.push({ id: uid('e'), from: branchId, to: leafId, label: '' });
    });
  });
  return { id: uid('mm'), name, nodes, edges };
};

const TEMPLATES: Template[] = [
  {
    name: 'Buying our first house',
    build: () =>
      templateMap('Buying our first house', [
        [
          ['Down payment', 'money', 'Target 20% to skip mortgage insurance.'],
          ['How much do we have?', 'question', ''],
          ['Monthly saving needed', 'money', ''],
          ['Gift or family help?', 'question', ''],
        ],
        [
          ['Where do we want to live?', 'idea', ''],
          ['Commute for both of us', 'question', ''],
          ['Schools and neighbours', 'idea', ''],
          ['Rent vs buy in that area', 'question', ''],
        ],
        [
          ['True cost of owning', 'money', 'Not just the mortgage.'],
          ['Property tax and insurance', 'money', ''],
          ['Maintenance ~1%/yr', 'money', ''],
          ['Furnishing and moving', 'money', ''],
        ],
        [
          ['Risks', 'risk', ''],
          ['One of us loses income', 'risk', ''],
          ['Rates move before we lock', 'risk', ''],
          ['Emergency fund still intact?', 'question', ''],
        ],
        [
          ['Milestones', 'milestone', ''],
          ['Pre-approval', 'milestone', ''],
          ['Offer accepted', 'milestone', ''],
          ['Keys in hand', 'milestone', ''],
        ],
      ]),
  },
  {
    name: 'Starting a family',
    build: () =>
      templateMap('Starting a family', [
        [
          ['Leave and income', 'money', ''],
          ['Parental leave policies', 'question', ''],
          ['Income dip for how long?', 'money', ''],
        ],
        [
          ['Childcare', 'money', ''],
          ['Nursery vs nanny vs family', 'question', ''],
          ['Cost per month', 'money', ''],
        ],
        [
          ['One-off costs', 'money', ''],
          ['Medical and delivery', 'money', ''],
          ['Gear, cot, car seat', 'money', ''],
          ['Bigger car?', 'question', ''],
        ],
        [
          ['Life admin', 'idea', ''],
          ['Life insurance', 'milestone', ''],
          ['Wills and guardianship', 'milestone', ''],
          ['Health cover for three', 'milestone', ''],
        ],
      ]),
  },
  {
    name: 'Retiring early',
    build: () =>
      templateMap('Retiring early', [
        [
          ['The number', 'money', '25× annual spending is the usual rule of thumb.'],
          ['What do we want to spend?', 'question', ''],
          ['Safe withdrawal rate', 'idea', ''],
        ],
        [
          ['Getting there', 'money', ''],
          ['Max the tax-advantaged accounts', 'milestone', ''],
          ['Taxable bridge fund', 'idea', ''],
        ],
        [
          ['What we would do', 'idea', ''],
          ['Part-time work?', 'question', ''],
          ['Travel year one', 'idea', ''],
        ],
        [
          ['Risks', 'risk', ''],
          ['Health cover before Medicare', 'risk', ''],
          ['Bad returns early on', 'risk', ''],
        ],
      ]),
  },
  {
    name: 'The big trip',
    build: () =>
      templateMap('The big trip', [
        [['Where and when', 'idea', ''], ['Shoulder season?', 'question', ''], ['How long can we take off?', 'question', '']],
        [['Budget', 'money', ''], ['Flights', 'money', ''], ['Stays', 'money', ''], ['Food and fun', 'money', '']],
        [['Prep', 'milestone', ''], ['Passports and visas', 'milestone', ''], ['Points and miles', 'idea', '']],
      ]),
  },
];

export default function MindMapPage() {
  const { state, dispatch, money } = useApp();
  const toast = useToast();
  const [mapId, setMapId] = useState<ID>(state.mindMaps[0]?.id ?? '');
  const map = state.mindMaps.find((m) => m.id === mapId) ?? state.mindMaps[0];
  const [selectedId, setSelectedId] = useState<ID | null>(null);
  const [linkFrom, setLinkFrom] = useState<ID | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, z: 0.8 });
  const canvasRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: ID; dx: number; dy: number } | null>(null);
  const pan = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [panning, setPanning] = useState(false);

  const selected = map?.nodes.find((n) => n.id === selectedId) ?? null;

  /** Frame every node in the viewport — used on load and by "Fit". */
  const fitView = useCallback(() => {
    const el = canvasRef.current;
    if (!el || !map || map.nodes.length === 0) return;
    const rect = el.getBoundingClientRect();
    const pad = 130;
    const xs = map.nodes.map((n) => n.x);
    const ys = map.nodes.map((n) => n.y);
    const minX = Math.min(...xs) - pad;
    const maxX = Math.max(...xs) + pad;
    const minY = Math.min(...ys) - pad;
    const maxY = Math.max(...ys) + pad;
    const z = Math.min(1.2, Math.max(0.28, Math.min(rect.width / (maxX - minX), rect.height / (maxY - minY))));
    setView({
      z,
      x: rect.width / 2 - ((minX + maxX) / 2) * z,
      y: rect.height / 2 - ((minY + maxY) / 2) * z,
    });
  }, [map]);

  // Re-frame when the visible map changes, not on every node edit.
  useEffect(() => {
    fitView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map?.id]);

  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const rect = canvasRef.current!.getBoundingClientRect();
      return {
        x: (clientX - rect.left - view.x) / view.z,
        y: (clientY - rect.top - view.y) / view.z,
      };
    },
    [view],
  );

  const onCanvasPointerDown = (e: React.PointerEvent) => {
    if (e.target !== e.currentTarget) return;
    setSelectedId(null);
    pan.current = { x: e.clientX, y: e.clientY, ox: view.x, oy: view.y };
    setPanning(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (drag.current && map) {
      const w = toWorld(e.clientX, e.clientY);
      dispatch({
        type: 'node/update',
        mapId: map.id,
        id: drag.current.id,
        patch: { x: Math.round(w.x - drag.current.dx), y: Math.round(w.y - drag.current.dy) },
      });
      return;
    }
    if (pan.current) {
      setView((v) => ({
        ...v,
        x: pan.current!.ox + (e.clientX - pan.current!.x),
        y: pan.current!.oy + (e.clientY - pan.current!.y),
      }));
    }
  };

  const endGesture = () => {
    drag.current = null;
    pan.current = null;
    setPanning(false);
  };

  const onWheel = (e: React.WheelEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    setView((v) => {
      const z = Math.min(2.2, Math.max(0.3, v.z * (e.deltaY < 0 ? 1.1 : 0.9)));
      // Keep the point under the cursor fixed while zooming.
      return { z, x: mx - ((mx - v.x) / v.z) * z, y: my - ((my - v.y) / v.z) * z };
    });
  };

  const addNode = (kind: MindNodeKind = 'idea', at?: { x: number; y: number }) => {
    if (!map) return;
    const node: MindNode = {
      id: uid('n'),
      label: 'New thought',
      detail: '',
      kind,
      x: at?.x ?? Math.round(600 + (Math.random() - 0.5) * 260),
      y: at?.y ?? Math.round(380 + (Math.random() - 0.5) * 200),
    };
    dispatch({ type: 'node/add', mapId: map.id, node });
    if (selectedId) {
      dispatch({
        type: 'edge/add',
        mapId: map.id,
        edge: { id: uid('e'), from: selectedId, to: node.id, label: '' },
      });
    }
    setSelectedId(node.id);
  };

  const nodeById = useMemo(
    () => new Map((map?.nodes ?? []).map((n) => [n.id, n])),
    [map],
  );

  const estimateTotal = sum((map?.nodes ?? []).map((n) => n.estimate ?? 0));

  if (!map) {
    return (
      <Card>
        <button
          className="btn primary"
          onClick={() =>
            dispatch({
              type: 'map/add',
              map: { id: uid('mm'), name: 'New map', nodes: [], edges: [] },
            })
          }
        >
          Create your first mind map
        </button>
      </Card>
    );
  }

  return (
    <div className="col gap-16">
      <div className="map-toolbar">
        <select className="select" style={{ maxWidth: 240 }} value={map.id} onChange={(e) => setMapId(e.target.value)}>
          {state.mindMaps.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <button className="btn sm" onClick={() => addNode('idea')}>
          + Node {selectedId ? '(linked)' : ''}
        </button>
        <button
          className={`btn sm ${linkFrom ? 'primary' : ''}`}
          onClick={() => setLinkFrom(linkFrom ? null : selectedId)}
          disabled={!selectedId && !linkFrom}
          title="Pick a node, click Connect, then click the node to link it to"
        >
          {linkFrom ? 'Click a target…' : '⇢ Connect'}
        </button>
        <div className="seg">
          {(['goal', 'money', 'question', 'risk', 'milestone'] as MindNodeKind[]).map((k) => (
            <button key={k} onClick={() => addNode(k)} title={`Add a ${KIND_META[k].label.toLowerCase()}`}>
              {KIND_META[k].icon}
            </button>
          ))}
        </div>
        <div className="spacer" />
        <span className="tiny faint">
          {map.nodes.length} nodes · estimates total {money(estimateTotal)}
        </span>
        <button className="btn ghost sm" onClick={fitView}>
          Fit to view
        </button>
        <select
          className="select"
          style={{ maxWidth: 190 }}
          value=""
          onChange={(e) => {
            const t = TEMPLATES.find((x) => x.name === e.target.value);
            if (!t) return;
            const built = t.build();
            dispatch({ type: 'map/add', map: built });
            setMapId(built.id);
            toast(`Added the "${t.name}" map`);
          }}
        >
          <option value="">Start from a template…</option>
          {TEMPLATES.map((t) => (
            <option key={t.name} value={t.name}>
              {t.name}
            </option>
          ))}
        </select>
        <button
          className="btn sm"
          onClick={() => {
            const built: MindMap = {
              id: uid('mm'),
              name: 'Untitled map',
              nodes: [{ id: uid('n'), label: 'Start here', detail: '', kind: 'root', x: 640, y: 380 }],
              edges: [],
            };
            dispatch({ type: 'map/add', map: built });
            setMapId(built.id);
          }}
        >
          + New map
        </button>
      </div>

      <div className="grid side">
        <div
          ref={canvasRef}
          className={`map-canvas ${panning ? 'panning' : ''}`}
          onPointerDown={onCanvasPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endGesture}
          onPointerLeave={endGesture}
          onWheel={onWheel}
          onDoubleClick={(e) => {
            if (e.target !== e.currentTarget) return;
            addNode('idea', toWorld(e.clientX, e.clientY));
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`,
              transformOrigin: '0 0',
              pointerEvents: 'none',
            }}
          >
            <svg style={{ position: 'absolute', overflow: 'visible', width: 1, height: 1 }}>
              {map.edges.map((e) => {
                const a = nodeById.get(e.from);
                const b = nodeById.get(e.to);
                if (!a || !b) return null;
                const mx = (a.x + b.x) / 2;
                return (
                  <g key={e.id}>
                    <path
                      d={`M${a.x},${a.y} C${mx},${a.y} ${mx},${b.y} ${b.x},${b.y}`}
                      fill="none"
                      stroke="var(--border-strong)"
                      strokeWidth={1.6}
                    />
                    {e.label && (
                      <text x={mx} y={(a.y + b.y) / 2 - 5} textAnchor="middle" style={{ fill: 'var(--text-faint)', fontSize: 10 }}>
                        {e.label}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>

            {map.nodes.map((n) => {
              const goal = n.goalId ? state.goals.find((g) => g.id === n.goalId) : undefined;
              const status = goal ? goalStatus(goal) : null;
              return (
                <div
                  key={n.id}
                  className={[
                    'map-node',
                    `kind-${n.kind}`,
                    n.id === selectedId ? 'selected' : '',
                    linkFrom && linkFrom !== n.id ? 'linking' : '',
                    n.done ? 'done' : '',
                    drag.current?.id === n.id ? 'dragging' : '',
                  ].join(' ')}
                  style={{ left: n.x, top: n.y, pointerEvents: 'auto' }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    if (linkFrom && linkFrom !== n.id) {
                      dispatch({
                        type: 'edge/add',
                        mapId: map.id,
                        edge: { id: uid('e'), from: linkFrom, to: n.id, label: '' },
                      });
                      setLinkFrom(null);
                      return;
                    }
                    setSelectedId(n.id);
                    const w = toWorld(e.clientX, e.clientY);
                    drag.current = { id: n.id, dx: w.x - n.x, dy: w.y - n.y };
                    (e.currentTarget.parentElement!.parentElement as HTMLElement).setPointerCapture(e.pointerId);
                  }}
                >
                  <div className="node-label">
                    {n.kind !== 'root' && `${KIND_META[n.kind].icon} `}
                    {n.label}
                  </div>
                  {n.detail && <div className="node-meta">{n.detail}</div>}
                  {n.estimate ? <div className="node-meta num">{money(n.estimate)}</div> : null}
                  {status && (
                    <div style={{ marginTop: 6 }}>
                      <Progress value={status.progress} tone={status.onTrack ? 'good' : 'warn'} thin />
                      <div className="node-meta num">
                        {money(status.goal.saved, { compact: true })} of{' '}
                        {money(status.goal.target, { compact: true })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="col gap-16">
          <Card title="Map">
            <Field label="Name">
              <input
                className="input"
                value={map.name}
                onChange={(e) => dispatch({ type: 'map/update', id: map.id, patch: { name: e.target.value } })}
              />
            </Field>
            <div className="row gap-6 mt-16">
              <ConfirmButton
                className="btn danger sm"
                onConfirm={() => {
                  dispatch({ type: 'map/remove', id: map.id });
                  setMapId(state.mindMaps.find((m) => m.id !== map.id)?.id ?? '');
                  toast('Map deleted');
                }}
              >
                Delete map
              </ConfirmButton>
            </div>
            <p className="tiny faint mt-8">
              Drag to move nodes, drag the background to pan, scroll to zoom, double-click empty space to
              add a thought. Select a node then press “+ Node” to branch off it.
            </p>
          </Card>

          {selected ? (
            <Card title="Selected node">
              <Field label="Label">
                <input
                  className="input"
                  value={selected.label}
                  onChange={(e) =>
                    dispatch({ type: 'node/update', mapId: map.id, id: selected.id, patch: { label: e.target.value } })
                  }
                />
              </Field>
              <Field label="Detail">
                <textarea
                  className="textarea"
                  value={selected.detail}
                  onChange={(e) =>
                    dispatch({ type: 'node/update', mapId: map.id, id: selected.id, patch: { detail: e.target.value } })
                  }
                />
              </Field>
              <Field label="Type">
                <select
                  className="select"
                  value={selected.kind}
                  onChange={(e) =>
                    dispatch({
                      type: 'node/update',
                      mapId: map.id,
                      id: selected.id,
                      patch: { kind: e.target.value as MindNodeKind },
                    })
                  }
                >
                  {(Object.keys(KIND_META) as MindNodeKind[]).map((k) => (
                    <option key={k} value={k}>
                      {KIND_META[k].icon} {KIND_META[k].label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Cost estimate" hint="Rolls up into the total at the top">
                <MoneyInput
                  value={selected.estimate ?? 0}
                  onChange={(c) =>
                    dispatch({ type: 'node/update', mapId: map.id, id: selected.id, patch: { estimate: c } })
                  }
                />
              </Field>
              <Field label="Link to a goal" hint="Shows live progress on the canvas">
                <select
                  className="select"
                  value={selected.goalId ?? ''}
                  onChange={(e) =>
                    dispatch({
                      type: 'node/update',
                      mapId: map.id,
                      id: selected.id,
                      patch: { goalId: e.target.value || undefined },
                    })
                  }
                >
                  <option value="">Not linked</option>
                  {state.goals
                    .filter((g) => !g.archived)
                    .map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Owner">
                <select
                  className="select"
                  value={selected.owner ?? 'joint'}
                  onChange={(e) =>
                    dispatch({
                      type: 'node/update',
                      mapId: map.id,
                      id: selected.id,
                      patch: { owner: e.target.value as ID | 'joint' },
                    })
                  }
                >
                  <option value="joint">Both of us</option>
                  {state.people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
              <label className="row gap-6 small mt-8">
                <input
                  type="checkbox"
                  checked={selected.done ?? false}
                  onChange={(e) =>
                    dispatch({ type: 'node/update', mapId: map.id, id: selected.id, patch: { done: e.target.checked } })
                  }
                />
                Done
              </label>
              <div className="row gap-6 mt-16">
                <button className="btn sm" onClick={() => addNode('idea')}>
                  Branch from here
                </button>
                <ConfirmButton
                  onConfirm={() => {
                    dispatch({ type: 'node/remove', mapId: map.id, id: selected.id });
                    setSelectedId(null);
                  }}
                >
                  Delete node
                </ConfirmButton>
              </div>
            </Card>
          ) : (
            <Card title="Nothing selected" hint="Click a node to edit it, or double-click the canvas to add one.">
              <div className="col gap-6">
                {map.nodes
                  .filter((n) => n.estimate)
                  .sort((a, b) => (b.estimate ?? 0) - (a.estimate ?? 0))
                  .map((n) => (
                    <div key={n.id} className="list-row">
                      <span>{KIND_META[n.kind].icon}</span>
                      <span className="small truncate">{n.label}</span>
                      <span className="spacer" />
                      <span className="small num">{money(n.estimate ?? 0)}</span>
                    </div>
                  ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
