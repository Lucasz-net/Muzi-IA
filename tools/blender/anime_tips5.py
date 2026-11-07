import bpy, bmesh, sys, random, mathutils
import numpy as np
from mathutils import Vector
src, dst = sys.argv[sys.argv.index("--")+1:][:2]
Z = 1.46             # altura del corte recto (hombros)
TIP_MIN, TIP_MAX = 0.035, 0.085   # largo de las puntas
MID_WIDTH = 0.55     # ancho del mechón a mitad de la punta (proporción)
BONE_MARGIN = 0.10   # se conservan los huesos hasta 10 cm bajo el corte (las puntas cuelgan de ellos)
EPS = 1e-4
rng = random.Random(7)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.preferences.addon_enable(module="bl_ext.user_default.vrm")
bpy.ops.import_scene.vrm(filepath=src)
arm = [o for o in bpy.data.objects if o.type == "ARMATURE"][0]
o = bpy.data.objects["Lozy Hair$Back$7"]
mw = o.matrix_world
assert (mw.to_3x3() @ Vector((0, 0, 1)) - Vector((0, 0, 1))).length < 1e-6 and abs(mw.translation.z) < 1e-6

bm = bmesh.new(); bm.from_mesh(o.data)
dl = bm.verts.layers.deform.verify()
uvl = bm.loops.layers.uv.active
assert uvl is not None, "sin UV"
geom = list(bm.verts) + list(bm.edges) + list(bm.faces)
bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, 0, Z), plane_no=(0, 0, 1), clear_inner=True)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
bm.verts.ensure_lookup_table(); bm.edges.ensure_lookup_table()
print("AFTER_CUT verts", len(bm.verts), "faces", len(bm.faces))

at_plane = lambda v: abs(v.co.z - Z) < EPS
bedges = [e for e in bm.edges if e.is_boundary and at_plane(e.verts[0]) and at_plane(e.verts[1])]
adj = {}
for e in bedges:
    a, b = e.verts
    adj.setdefault(a, []).append((b, e)); adj.setdefault(b, []).append((a, e))
seen = set(); chains = []
for v in adj:
    if v in seen: continue
    comp, stack = [], [v]; seen.add(v)
    while stack:
        x = stack.pop(); comp.append(x)
        for y, _ in adj[x]:
            if y not in seen: seen.add(y); stack.append(y)
    chains.append(comp)
print("CHAINS", len(chains), "sizes", sorted({len(c) for c in chains}))

down = Vector((0, 0, -1))
def face_uv_matrix(f):
    ls = list(f.loops)[:3]
    p0 = ls[0].vert.co; u0 = ls[0][uvl].uv
    P = np.array([[(l.vert.co - p0)[i] for l in ls[1:]] for i in range(3)])           # 3x2
    U = np.array([[(l[uvl].uv - u0)[i] for l in ls[1:]] for i in range(2)])           # 2x2
    return U @ np.linalg.pinv(P)                                                       # 2x3

def clone_weights(src_v, dst_v):
    dst_v[dl].clear()
    for g, w in src_v[dl].items(): dst_v[dl][g] = w

made = 0
for comp in chains:
    c = sum((v.co for v in comp), Vector()) / len(comp)
    L = rng.uniform(TIP_MIN, TIP_MAX)
    ring = {}
    for v in comp:
        r = bm.verts.new(c + (v.co - c) * MID_WIDTH + down * (L * 0.5))
        clone_weights(v, r); ring[v] = r
    tip = bm.verts.new(c + down * L)
    clone_weights(min(comp, key=lambda v: (v.co - c).length), tip)
    es = {e for v in comp for y, e in adj[v]}
    for e in es:
        f0 = e.link_faces[0]
        a = b = None
        for l in f0.loops:
            if l.edge == e: a, b = l.vert, l.link_loop_next.vert
        M = face_uv_matrix(f0)
        uva = next(l[uvl].uv.copy() for l in f0.loops if l.vert == a)
        uvb = next(l[uvl].uv.copy() for l in f0.loops if l.vert == b)
        Ra, Rb = ring[a], ring[b]
        def duv(pnew, pold):
            d = pnew - pold
            return Vector(M @ np.array([d.x, d.y, d.z]))
        q = bm.faces.new([b, a, Ra, Rb]); q.material_index = f0.material_index; q.smooth = f0.smooth
        uv = {b: uvb, a: uva, Ra: uva + duv(Ra.co, a.co), Rb: uvb + duv(Rb.co, b.co)}
        for l in q.loops: l[uvl].uv = uv[l.vert]
        t = bm.faces.new([Rb, Ra, tip]); t.material_index = f0.material_index; t.smooth = f0.smooth
        mid_uv = (uv[Ra] + uv[Rb]) / 2
        uv_tip = mid_uv + duv(tip.co, (Ra.co + Rb.co) / 2)
        uv[tip] = uv_tip
        for l in t.loops: l[uvl].uv = uv[l.vert]
    made += 1
bm.normal_update()
bm.to_mesh(o.data); bm.free(); o.data.update()
zs = [v.co.z for v in o.data.vertices]
print("TIPS", made, "verts", len(o.data.vertices), "z %.3f..%.3f" % (min(zs), max(zs)))

# Huesos de pelo muy por debajo del corte: se eliminan y sus pesos pasan al hueso superior.
bones = arm.data.bones
head_z = {b.name: b.head_local.z for b in bones}
ext = arm.data.vrm_addon_extension
roots = [bg.bone_name for g in ext.vrm0.secondary_animation.bone_groups[:1] for bg in g.bones]
chain = set()
def walk(b):
    chain.add(b.name)
    for c in b.children: walk(c)
for r in roots:
    if r in bones: walk(bones[r])
remove = {x for x in chain if head_z[x] < Z - BONE_MARGIN}
changed = True
while changed:
    changed = False
    for x in list(remove):
        if any(c.name not in remove for c in bones[x].children): remove.discard(x); changed = True
print("CHAIN", len(chain), "REMOVE", len(remove))
def kept_ancestor(x):
    p = bones[x].parent
    while p is not None and p.name in remove: p = p.parent
    return p.name if p else None
target = {x: kept_ancestor(x) for x in remove}
for ob in bpy.data.objects:
    if ob.type != "MESH" or not any(vg.name in remove for vg in ob.vertex_groups): continue
    names = {vg.index: vg.name for vg in ob.vertex_groups}
    for v in ob.data.vertices:
        for ge in list(v.groups):
            nm = names.get(ge.group)
            if nm in remove and ge.weight > 0 and target[nm]:
                tvg = ob.vertex_groups.get(target[nm]) or ob.vertex_groups.new(name=target[nm])
                tvg.add([v.index], ge.weight, "ADD")
    for vg in [vg for vg in ob.vertex_groups if vg.name in remove]: ob.vertex_groups.remove(vg)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode="EDIT")
for x in remove:
    eb = arm.data.edit_bones.get(x)
    if eb: arm.data.edit_bones.remove(eb)
bpy.ops.object.mode_set(mode="OBJECT")
for g in ext.vrm0.secondary_animation.bone_groups:
    for i in reversed(range(len(g.bones))):
        if g.bones[i].bone_name not in arm.data.bones: g.bones.remove(i)

# ---- Colliders + grupos de pelo ----
import uuid
bpy.context.view_layer.update()
sa = ext.vrm0.secondary_animation
hbmap = {hb.bone: hb.node.bone_name for hb in ext.vrm0.humanoid.human_bones if hb.node.bone_name in arm.data.bones}
def wpos(name, t):
    b = arm.data.bones[name]
    return arm.matrix_world @ (b.head_local.lerp(b.tail_local, t))
# (tag, hueso humanoide, posiciones a lo largo del hueso, radio); tag: "both" = pelo de atrás y de delante, "back" = solo pelo de atrás
SPEC = []
for side in ("left", "right"):
    SPEC += [("both", side + "Shoulder", (0.5,), 0.11),
             ("back", side + "UpperArm", (0.3, 0.7), 0.085),
             ("back", side + "LowerArm", (0.3, 0.7), 0.075),
             ("back", side + "Hand", (0.4,), 0.05)]
SPEC += [("both", "chest", (0.3, 0.9), 0.15), ("both", "spine", (0.5,), 0.14), ("back", "neck", (0.2,), 0.07)]
by_bone = {}   # (hueso) -> [(tag, pos, radio)]
for tag, key, ts, r in SPEC:
    if key in hbmap:
        for t in ts: by_bone.setdefault(hbmap[key], []).append((tag, wpos(hbmap[key], t), r))
# Esfera delante de la boca/mejillas: evita que mechones laterales y la trenza crucen la cara (coordenadas del modelo: frente = -Y).
if "head" in hbmap:
    by_bone.setdefault(hbmap["head"], []).append(("both", arm.matrix_world @ mathutils.Vector((0.0, -0.035, 1.60)), 0.055))
# Ajuste de radios: ninguna esfera puede contener en reposo a una articulación de pelo (más el radio de golpe);
# si la contiene, el pelo se empuja fuera todo el tiempo y sale despedido en pinchos.
HIT = sa.bone_groups[0].hit_radius
joints = []
for nm in chain:
    if nm in arm.data.bones:
        bb = arm.data.bones[nm]
        joints += [arm.matrix_world @ bb.head_local, arm.matrix_world @ bb.tail_local]
fitted = {}
for bname, items in by_bone.items():
    for k, (tag, pos, r) in enumerate(items):
        dmin = min((pos - j).length for j in joints)
        r2 = min(r, dmin - HIT - 0.008)
        if r2 < r: fitted[(bname, k)] = (round(r, 3), round(r2, 3))
        items[k] = (tag, pos, max(r2, 0.0))
    by_bone[bname] = [it for it in items if it[2] >= 0.02]   # esferas que no caben se descartan
print("FITTED", fitted)
print("SPHERES", sum(len(v) for v in by_bone.values()), "of", sum(1 for _ in SPEC))
uuid_tags = {}  # uuid -> tags presentes
for bname, items in by_bone.items():
    for tag in ("both", "back"):
        its = [(p, r) for tg, p, r in items if tg == tag]
        if not its: continue
        g = sa.collider_groups.add()           # referencia recién creada (no se guarda: la colección puede reubicarse)
        g.uuid = uuid.uuid4().hex; g.node.bone_name = bname
        uuid_tags[g.uuid] = tag
        for k, (pos, r) in enumerate(its):
            c = g.colliders.add()
            obj = bpy.data.objects.new(name=f"{bname}_{tag}_collider_{k}", object_data=None)
            bpy.context.scene.collection.objects.link(obj)
            c.bpy_object = obj
            obj.parent = arm; obj.parent_type = "BONE"; obj.parent_bone = bname
            rest_head = arm.matrix_world @ arm.data.bones[bname].head_local
            pose_head = (arm.matrix_world @ arm.pose.bones[bname].matrix).to_translation()
            obj.matrix_world = mathutils.Matrix.Translation(pose_head + (pos - rest_head))
            obj.empty_display_type = "SPHERE"; obj.empty_display_size = r
bpy.context.view_layer.update()
for i in range(len(sa.collider_groups)): sa.collider_groups[i].fixup(arm)

# Pelo de delante (trenza, mechones laterales y flequillo): grupo aparte, sin colliders de brazos.
FRONT_MESHES = ["Lozy Hair$Braid$8", "Lozy Hair$Side$10", "Lozy Hair$Front$9"]
def weight_in(mesh_name, names):
    ob = bpy.data.objects[mesh_name]; idx = {vg.index for vg in ob.vertex_groups if vg.name in names}
    return sum(ge.weight for v in ob.data.vertices for ge in v.groups if ge.group in idx)
def chain_names(root):
    out = set()
    def w(b):
        out.add(b.name); [w(c) for c in b.children]
    w(arm.data.bones[root]); return out
roots0 = [bg.bone_name for bg in sa.bone_groups[0].bones]
front_roots, back_roots = [], []
for r in roots0:
    names = chain_names(r)
    wf = sum(weight_in(m, names) for m in FRONT_MESHES); wb = weight_in("Lozy Hair$Back$7", names)
    (front_roots if wf > wb else back_roots).append(r)
print("ROOTS back", len(back_roots), "front", len(front_roots))
g0 = sa.bone_groups[0]
settings = dict(stiffiness=g0.stiffiness, gravity_power=g0.gravity_power, gravity_dir=tuple(g0.gravity_dir), drag_force=g0.drag_force, hit_radius=g0.hit_radius, center=g0.center.bone_name)
print("G0", settings)
# quitar las raíces de delante del grupo 0 y crear el grupo nuevo
for i in reversed(range(len(g0.bones))):
    if g0.bones[i].bone_name in front_roots: g0.bones.remove(i)
gf = sa.bone_groups.add()
gf.comment = "pelo de delante"
gf.stiffiness = 1.8; gf.gravity_power = settings["gravity_power"]; gf.gravity_dir = settings["gravity_dir"]
gf.drag_force = 0.6; gf.hit_radius = settings["hit_radius"]
for r in front_roots:
    nb = gf.bones.add(); nb.bone_name = r
g0 = sa.bone_groups[0]; g0.stiffiness = 1.4
gf = sa.bone_groups[len(sa.bone_groups) - 1]
for u, tag in uuid_tags.items():
    ref = g0.collider_groups.add(); ref.collider_group_uuid = u
    if tag == "both":
        rf = gf.collider_groups.add(); rf.collider_group_uuid = u
print("COLLIDERS groups", len(uuid_tags), "both", sum(1 for t in uuid_tags.values() if t == "both"), "bone_groups", [(len(g.bones), len(g.collider_groups)) for g in sa.bone_groups])

bpy.ops.export_scene.vrm(filepath=dst)
print("EXPORTED", dst)
