#!/usr/bin/env python3
import math
from manim import *

config.disable_caching = True

BG = "#0A0A0A"
BLUE = "#00F5FF"
GREEN = "#39FF14"
MAGENTA = "#FF00FF"
ORANGE = "#FF9F1C"
PURPLE = "#BD93F9"
CYAN = "#00E5FF"
YELLOW = "#FFD700"
WHITE = "#F8F8F2"
MONO = "DejaVu Sans Mono"

TITLE = 48
HEADING = 36
BODY = 24
LABEL = 20
CODE = 18


def chip(text, color, width=2.4, height=0.6):
    rect = RoundedRectangle(
        corner_radius=0.12, width=width, height=height,
        color=color, fill_opacity=0.12, stroke_width=1.5
    )
    label = Text(text, font_size=BODY, color=color, font=MONO)
    label.move_to(rect.get_center())
    return VGroup(rect, label)


def log_line(text_str, color=GREEN):
    return Text(text_str, font_size=CODE, color=color, font=MONO)


def dist(a, b):
    return math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2)


def _build_module_layout(hub, modules):
    """Build satellite chips and hub-and-spoke connectors for the architecture scene.

    Args:
        hub: The central hub VMobject (must have .get_center()).
        modules: Iterable of (name, color, position) tuples.

    Returns:
        Tuple of (satellites VGroup, spokes VGroup).

    Raises:
        ValueError: If modules is empty or hub center cannot be computed.
    """
    if not modules:
        raise ValueError("modules must contain at least one (name, color, pos) tuple")

    try:
        hub_center = hub.get_center()
    except Exception as exc:
        raise ValueError(f"hub must expose get_center(), got error: {exc}") from exc

    satellites = VGroup()
    spokes = VGroup()
    for name, color, pos in modules:
        sat = chip(name, color, width=2.0, height=0.55)
        sat.move_to(pos)
        satellites.add(sat)

        d = dist(hub_center, sat.get_center()) or 1
        start = hub_center + (pos - hub_center) * (0.9 / d)
        end = sat.get_center() + (hub_center - sat.get_center()) * (0.1 / d)
        spoke = Line(start, end, color=color, stroke_width=1.2)
        spokes.add(spoke)

    return satellites, spokes


def _build_architecture_scene_elements():
    """Build the hub, module layout, satellites, and spokes for the architecture scene.

    Returns:
        Tuple of (hub_group, satellites, spokes, modules).
    """
    hub = Circle(radius=0.9, color=MAGENTA, fill_opacity=0.15, stroke_width=2)
    hub_symbol = chimera_symbol(scale=0.5, color=MAGENTA)
    hub_symbol.move_to(hub.get_center())
    hub_label = Text("Chimera", font_size=LABEL, color=MAGENTA, font=MONO)
    hub_label.next_to(hub, DOWN, buff=0.15)
    hub_group = VGroup(hub, hub_symbol, hub_label)
    hub_group.move_to(ORIGIN)

    modules = [
        ("AuthService", ORANGE, UP * 2.6),
        ("Hypercore\nStore", GREEN, UP * 1.3 + LEFT * 3.2),
        ("PearP2P", PURPLE, UP * 1.3 + RIGHT * 3.2),
        ("Multisig\nManager", MAGENTA, LEFT * 2.8),
        ("Wallet\nManager", "#FF00AA", RIGHT * 2.8),
        ("Time\nScheduler", BLUE, DOWN * 1.3 + LEFT * 3.2),
        ("Task\nMonitor", CYAN, DOWN * 1.3 + RIGHT * 3.2),
        ("QVAC\nInference", GREEN, DOWN * 2.3 + LEFT * 1.6),
        ("Inference\nRouter", "#FF00AA", DOWN * 2.3 + RIGHT * 1.6),
        ("Miner\nManager", ORANGE, DOWN * 1.3),
        ("WebServer", PURPLE, DOWN * 2.9),
    ]

    satellites, spokes = _build_module_layout(hub, modules)
    return hub_group, satellites, spokes, modules


def chimera_symbol(scale=1.0, color=BLUE):
    """Convergence chimera: disparate stars and DNA strands merging
    into a single unified organism. Three distinct natures, one body."""
    s = scale

    # Central nucleus — the unified organism (outline only, no fill)
    nucleus = Circle(radius=0.35 * s, color=color, fill_opacity=0, stroke_width=2.5)
    nucleus_inner = Circle(radius=0.18 * s, color=WHITE, fill_opacity=0, stroke_width=1)

    # DNA helix inside the nucleus
    helix = VGroup()
    for i in range(8):
        t = i / 7.0
        angle = t * 2 * PI
        x = 0.22 * s * math.cos(angle)
        y1 = 0.22 * s * math.sin(angle) - 0.05 * s
        y2 = 0.22 * s * math.sin(angle + PI) - 0.05 * s
        rung = Line(
            np.array([x, y1, 0]),
            np.array([-x, y2, 0]),
            color=MAGENTA, stroke_width=1.2
        )
        helix.add(rung)

    # Strand 1 — Celestial/Inference (blue): a 5-pointed star merging into nucleus
    star_points = []
    for i in range(10):
        r = 0.25 * s if i % 2 == 0 else 0.12 * s
        angle = i * PI / 5 - PI / 2
        star_points.append(np.array([
            r * math.cos(angle) - 1.1 * s,
            r * math.sin(angle) + 0.5 * s,
            0
        ]))
    star = Polygon(*star_points, color=BLUE, fill_opacity=0.1, stroke_width=2)
    strand1 = VMobject(color=BLUE, stroke_width=2.5)
    strand1.set_points_smoothly([
        star.get_center(),
        star.get_center() + RIGHT * 0.4 * s + DOWN * 0.25 * s,
        star.get_center() + RIGHT * 0.75 * s + DOWN * 0.1 * s,
        nucleus.get_center() + LEFT * 0.25 * s + UP * 0.1 * s,
    ])
    for i in range(5):
        t = (i + 1) / 6.0
        pt = strand1.point_from_proportion(t)
        dot = Dot(radius=0.04 * s, color=CYAN).move_to(pt)
        strand1.add(dot)

    # Strand 2 — Mining/Compute (orange): a hexagonal molecular structure
    hex_pts = []
    for i in range(6):
        angle = i * PI / 3
        hex_pts.append(np.array([
            0.2 * s * math.cos(angle) + 1.0 * s,
            0.2 * s * math.sin(angle) + 0.55 * s,
            0
        ]))
    hexagon = Polygon(*hex_pts, color=ORANGE, fill_opacity=0.1, stroke_width=2)
    # Inner bonds
    hex_bonds = VGroup(*[
        Line(hex_pts[i], hex_pts[(i + 2) % 6], color=ORANGE, stroke_width=1, stroke_opacity=0.4)
        for i in range(3)
    ])
    strand2 = VMobject(color=ORANGE, stroke_width=2.5)
    strand2.set_points_smoothly([
        hexagon.get_center(),
        hexagon.get_center() + LEFT * 0.35 * s + DOWN * 0.2 * s,
        hexagon.get_center() + LEFT * 0.7 * s + DOWN * 0.05 * s,
        nucleus.get_center() + RIGHT * 0.25 * s + UP * 0.08 * s,
    ])
    for i in range(5):
        t = (i + 1) / 6.0
        pt = strand2.point_from_proportion(t)
        dot = Dot(radius=0.04 * s, color=YELLOW).move_to(pt)
        strand2.add(dot)

    # Strand 3 — P2P/Network (green): orbital rings with a triangular node
    tri = Triangle(color=GREEN, fill_opacity=0.1, stroke_width=2).scale(0.22 * s)
    tri.move_to(np.array([0.0 * s, -0.85 * s, 0]))
    orbit1 = Circle(radius=0.35 * s, color=GREEN, fill_opacity=0, stroke_width=1, stroke_opacity=0.4)
    orbit1.move_to(tri.get_center())
    orbit2 = Circle(radius=0.48 * s, color=GREEN, fill_opacity=0, stroke_width=1, stroke_opacity=0.25)
    orbit2.move_to(tri.get_center())
    strand3 = VMobject(color=GREEN, stroke_width=2.5)
    strand3.set_points_smoothly([
        tri.get_center(),
        tri.get_center() + UP * 0.3 * s + LEFT * 0.1 * s,
        tri.get_center() + UP * 0.6 * s + RIGHT * 0.05 * s,
        nucleus.get_center() + DOWN * 0.25 * s,
    ])
    for i in range(5):
        t = (i + 1) / 6.0
        pt = strand3.point_from_proportion(t)
        dot = Dot(radius=0.04 * s, color=GREEN).move_to(pt)
        strand3.add(dot)

    # Orbital ring around the whole organism (outline only)
    outer_ring = Circle(radius=1.35 * s, color=color, fill_opacity=0, stroke_width=1, stroke_opacity=0.2)

    symbol = VGroup(
        outer_ring,
        strand1, star,
        strand2, hexagon, hex_bonds,
        strand3, tri, orbit1, orbit2,
        helix, nucleus_inner, nucleus
    )
    return symbol


class Scene1_Hook(Scene):
    def construct(self):
        self.camera.background_color = BG

        frame = RoundedRectangle(
            corner_radius=0.15, width=10, height=5.5,
            color="#333333", fill_opacity=0.15, stroke_width=1
        )
        frame.to_edge(UP, buff=0.8)
        header = Text("chimera-node", font_size=CODE, color=WHITE, font=MONO)
        header.to_edge(UP, buff=1.0)
        header.align_to(frame, LEFT).shift(RIGHT * 0.6)

        logs = VGroup(
            log_line("> docker-compose up -d", BLUE),
            log_line("[Docker] Building chimera-node:latest...", GREEN),
            log_line("[Docker] Container chimera-node started", GREEN),
            log_line("[NodeManager] Initializing node components...", GREEN),
            log_line("[NodeManager] Node ID: 02b8357bdd44fbb6...", CYAN),
            log_line("[NodeManager] Dashboard: http://localhost:3000", CYAN),
            log_line("[Docker] Isolated runtime — host machine unaffected", GREEN),
        )
        logs.arrange(DOWN, aligned_edge=LEFT, buff=0.22)
        logs.move_to(frame.get_center()).shift(DOWN * 0.2).shift(LEFT * 3.2)

        # Chimera symbol on the right side of terminal
        symbol = chimera_symbol(scale=1.6, color=BLUE)
        symbol.next_to(frame.get_right(), LEFT, buff=1.0).shift(UP * 0.1)

        self.play(Create(frame), Write(header), run_time=0.8)
        for line in logs:
            self.play(Write(line), run_time=0.35)
        self.play(FadeIn(symbol), run_time=0.8)

        self.wait(0.4)

        title = Text(
            "Chimera", font_size=TITLE, color=BLUE,
            font=MONO, weight=BOLD
        )
        subtitle = Text(
            "Inference by Day. Looking to the Moon by Night.", font_size=BODY,
            color=GREEN, font=MONO
        )
        subtitle.next_to(title, DOWN, buff=0.35)
        title_group = VGroup(title, subtitle)
        title_group.to_edge(DOWN, buff=1.0)

        self.play(
            FadeIn(title_group, shift=UP),
            logs.animate.set_opacity(0.25),
            frame.animate.set_opacity(0.25),
            run_time=1.0
        )
        self.wait(1.5)
        self.play(FadeOut(VGroup(frame, header, logs, symbol, title_group)), run_time=0.6)


class Scene2_BigIdea(Scene):
    def construct(self):
        self.camera.background_color = BG

        header = Text("Dual-Mode Operation", font_size=HEADING, color=BLUE, font=MONO)
        header.to_edge(UP, buff=0.5)

        inf_bg = RoundedRectangle(
            corner_radius=0.2, width=4.5, height=4.2,
            color=BLUE, fill_opacity=0.06, stroke_width=1
        )
        inf_bg.to_edge(LEFT, buff=0.6).shift(DOWN * 0.2)
        inf_label = Text("Inference Mode", font_size=BODY, color=BLUE, font=MONO)
        inf_label.next_to(inf_bg, UP, buff=0.15)

        inf_items = VGroup(
            Text("Llama 2 / 3", font_size=LABEL, color=CYAN, font=MONO),
            Text("Speech-to-Text", font_size=LABEL, color=CYAN, font=MONO),
            Text("Translation", font_size=LABEL, color=CYAN, font=MONO),
            Text("RAG", font_size=LABEL, color=CYAN, font=MONO),
        )
        inf_items.arrange(DOWN, aligned_edge=LEFT, buff=0.35)
        inf_items.move_to(inf_bg.get_center())

        mine_bg = RoundedRectangle(
            corner_radius=0.2, width=4.5, height=4.2,
            color=ORANGE, fill_opacity=0.06, stroke_width=1
        )
        mine_bg.to_edge(RIGHT, buff=0.6).shift(DOWN * 0.2)
        mine_label = Text("Mining Mode", font_size=BODY, color=ORANGE, font=MONO)
        mine_label.next_to(mine_bg, UP, buff=0.15)

        miners = ["Cortensor", "Chutes", "Fortytwo", "Earnidle", "Routstr"]
        mine_items = VGroup(*[
            Text(m, font_size=LABEL, color=YELLOW, font=MONO) for m in miners
        ])
        mine_items.arrange(DOWN, aligned_edge=LEFT, buff=0.28)
        mine_items.move_to(mine_bg.get_center())

        gear_center = Circle(radius=0.7, color=MAGENTA, fill_opacity=0.08, stroke_width=1.5)
        gear_symbol = chimera_symbol(scale=0.55, color=MAGENTA)
        gear_symbol.move_to(gear_center.get_center())
        gear_label = Text("Chimera", font_size=LABEL, color=MAGENTA, font=MONO)
        gear_label.next_to(gear_center, DOWN, buff=0.15)
        gear = VGroup(gear_center, gear_symbol, gear_label)
        gear.move_to(ORIGIN).shift(DOWN * 0.2)

        self.play(Write(header), run_time=0.8)
        self.play(
            Create(inf_bg), Create(mine_bg),
            FadeIn(inf_label), FadeIn(mine_label),
            run_time=0.8
        )
        self.play(
            LaggedStart(*[Write(item) for item in inf_items], lag_ratio=0.2),
            run_time=1.2
        )
        self.play(
            LaggedStart(*[Write(item) for item in mine_items], lag_ratio=0.15),
            run_time=1.2
        )
        self.play(FadeIn(gear), run_time=0.6)

        self.play(Rotate(gear, angle=PI / 2, rate_func=smooth), run_time=1.5)
        self.play(
            Circumscribe(inf_bg, color=BLUE, time_width=0.3),
            Circumscribe(mine_bg, color=ORANGE, time_width=0.3),
            run_time=1.0
        )

        zero_idle = Text("Zero idle time", font_size=BODY, color=GREEN, font=MONO)
        zero_idle.to_edge(DOWN, buff=0.5)
        self.play(Write(zero_idle), run_time=0.8)
        self.wait(3.0)

        self.play(FadeOut(VGroup(
            header, inf_bg, mine_bg, inf_label, mine_label,
            inf_items, mine_items, gear, zero_idle
        )), run_time=0.6)


class Scene3_Architecture(Scene):
    def _build_architecture_scene(self):
        """Build the architecture deep-dive scene elements.

        Returns:
            Tuple of (header, hub_group, satellites, spokes, init_step, modules).
        """
        header = Text("Architecture Deep Dive", font_size=HEADING, color=CYAN, font=MONO)
        header.to_edge(UP, buff=0.4)

        hub = Circle(radius=0.9, color=MAGENTA, fill_opacity=0.15, stroke_width=2)
        hub_symbol = chimera_symbol(scale=0.5, color=MAGENTA)
        hub_symbol.move_to(hub.get_center())
        hub_label = Text("Chimera", font_size=LABEL, color=MAGENTA, font=MONO)
        hub_label.next_to(hub, DOWN, buff=0.15)
        hub_group = VGroup(hub, hub_symbol, hub_label)
        hub_group.move_to(ORIGIN)

        modules = [
            ("AuthService", ORANGE, UP * 2.6),
            ("Hypercore\nStore", GREEN, UP * 1.3 + LEFT * 3.2),
            ("PearP2P", PURPLE, UP * 1.3 + RIGHT * 3.2),
            ("Multisig\nManager", MAGENTA, LEFT * 2.8),
            ("Wallet\nManager", "#FF00AA", RIGHT * 2.8),
            ("Time\nScheduler", BLUE, DOWN * 1.3 + LEFT * 3.2),
            ("Task\nMonitor", CYAN, DOWN * 1.3 + RIGHT * 3.2),
            ("QVAC\nInference", GREEN, DOWN * 2.3 + LEFT * 1.6),
            ("Inference\nRouter", "#FF00AA", DOWN * 2.3 + RIGHT * 1.6),
            ("Miner\nManager", ORANGE, DOWN * 1.3),
            ("WebServer", PURPLE, DOWN * 2.9),
        ]

        satellites, spokes = _build_module_layout(hub, modules)

        init_step = Text("initialize() sequence", font_size=CODE, color=WHITE, font=MONO)
        init_step.to_edge(DOWN, buff=0.4)

        return header, hub_group, satellites, spokes, init_step, modules

    def construct(self):
        self.camera.background_color = BG

        header, hub_group, satellites, spokes, init_step, modules = self._build_architecture_scene()

        self.play(Write(header), run_time=0.8)
        self.play(FadeIn(hub_group), run_time=0.6)
        self.wait(0.3)

        for i in range(len(modules)):
            self.play(Create(spokes[i]), FadeIn(satellites[i]), run_time=0.45)
            if i == 0:
                self.play(Write(init_step), run_time=0.3)

        self.wait(0.6)

        inf_path = VGroup(spokes[7], spokes[8], satellites[7], satellites[8])
        mine_path = VGroup(spokes[9], satellites[9])
        self.play(
            inf_path.animate.set_stroke(color=BLUE, width=2.5),
            mine_path.animate.set_stroke(color=ORANGE, width=2.5),
            run_time=0.8
        )

        note = Text(
            "All miners share one centralized inference router",
            font_size=LABEL, color=CYAN, font=MONO
        )
        note.to_edge(DOWN, buff=0.65)
        self.play(Transform(init_step, note), run_time=0.6)
        self.wait(1.2)

        self.play(FadeOut(VGroup(header, hub_group, satellites, spokes, note)), run_time=0.6)


class Scene4_Runtime(Scene):
    def construct(self):
        self.camera.background_color = BG

        header = Text("Runtime Cycle", font_size=HEADING, color=BLUE, font=MONO)
        header.to_edge(UP, buff=0.4)

        timeline = Line(LEFT * 4.5, RIGHT * 4.5, color=WHITE, stroke_width=2)
        timeline.shift(UP * 0.5)

        day_label = Text("6 AM", font_size=LABEL, color=WHITE, font=MONO)
        day_label.next_to(timeline.get_start(), DOWN, buff=0.2)
        night_label = Text("8 PM", font_size=LABEL, color=WHITE, font=MONO)
        night_label.next_to(timeline.get_end(), DOWN, buff=0.2)

        sun = Circle(radius=0.35, color=YELLOW, fill_opacity=0.3)
        sun_label = Text("Day", font_size=LABEL, color=YELLOW, font=MONO)
        moon = Circle(radius=0.3, color=CYAN, fill_opacity=0.3)
        moon_label = Text("Night", font_size=LABEL, color=CYAN, font=MONO)
        sun_group = VGroup(sun, sun_label)
        moon_group = VGroup(moon, moon_label)
        sun_group.next_to(timeline.get_start(), UP, buff=0.3)
        moon_group.next_to(timeline.get_end(), UP, buff=0.3)

        self.play(Write(header), Create(timeline), run_time=0.8)
        self.play(Write(day_label), Write(night_label), run_time=0.5)
        self.play(FadeIn(sun_group), FadeIn(moon_group), run_time=0.6)

        self.play(sun_group.animate.move_to(timeline.get_end() + UP * 0.3), run_time=2.0, rate_func=linear)

        mode_tracker = ValueTracker(0)

        mode_text = Text("Day: Inference earning", font_size=BODY, color=YELLOW, font=MONO)
        mode_text.next_to(timeline, DOWN, buff=0.8)

        def update_mode_text(mob):
            val = mode_tracker.get_value()
            if val < 0.5:
                mob.become(
                    Text("Day: Inference earning", font_size=BODY, color=YELLOW, font=MONO)
                    .next_to(timeline, DOWN, buff=0.8)
                )
            else:
                mob.become(
                    Text("Night: AI Writer idle + Mining", font_size=BODY, color=CYAN, font=MONO)
                    .next_to(timeline, DOWN, buff=0.8)
                )

        mode_text.add_updater(update_mode_text)
        self.add(mode_text)
        self.play(mode_tracker.animate.set_value(1.0), run_time=1.5)
        self.wait(0.5)

        miners = ["Cortensor", "Chutes", "Fortytwo", "Earnidle", "Routstr"]
        miner_chips = VGroup(*[chip(m, ORANGE, width=1.8, height=0.45) for m in miners])
        miner_chips.arrange(RIGHT, buff=0.25)
        miner_chips.to_edge(DOWN, buff=1.2)

        parallel_label = Text(
            "Parallel monitoring — all miners active",
            font_size=LABEL, color=GREEN, font=MONO
        )
        parallel_label.next_to(miner_chips, UP, buff=0.25)

        self.play(
            FadeIn(parallel_label),
            LaggedStart(*[FadeIn(c) for c in miner_chips], lag_ratio=0.15),
            run_time=1.2
        )

        task = RoundedRectangle(
            corner_radius=0.1, width=2.0, height=0.5,
            color=BLUE, fill_opacity=0.15
        )
        task_label = Text("Inference Task", font_size=LABEL, color=BLUE, font=MONO)
        task_label.move_to(task.get_center())
        task_group = VGroup(task, task_label)
        task_group.to_edge(LEFT, buff=0.5).shift(UP * 1.5)

        self.play(FadeIn(task_group, shift=RIGHT), run_time=0.8)
        for c in miner_chips:
            self.play(Indicate(c, color=YELLOW, scale_factor=1.15), run_time=0.25)
        self.wait(0.6)

        idle_rule = Text("idleTimeout = 300000 ms", font_size=LABEL, color=GREEN, font=MONO)
        idle_rule.next_to(parallel_label, UP, buff=0.15)
        self.play(Write(idle_rule), run_time=0.6)
        self.wait(6.0)

        mode_text.remove_updater(update_mode_text)
        self.play(FadeOut(VGroup(
            header, timeline, day_label, night_label,
            sun_group, moon_group, mode_text,
            task_group, miner_chips, parallel_label, idle_rule
        )), run_time=0.6)


class Scene5_FundFlow(Scene):
    def construct(self):
        self.camera.background_color = BG

        header = Text("Fund Flow — Protocol Multisigs", font_size=HEADING, color=MAGENTA, font=MONO)
        header.to_edge(UP, buff=0.4)

        sources_label = Text("Sources", font_size=BODY, color=WHITE, font=MONO)
        sources_label.to_edge(LEFT, buff=0.6).shift(UP * 1.8)

        sources = VGroup(
            chip("Nostr\nCashu NIP-60", GREEN, width=2.2, height=0.7),
            chip("Bittensor\nSubstrate", GREEN, width=2.2, height=0.7),
            chip("Solana\nDirect", GREEN, width=2.2, height=0.7),
            chip("EVM\nDirect", GREEN, width=2.2, height=0.7),
        )
        sources.arrange(DOWN, buff=0.35)
        sources.next_to(sources_label, DOWN, buff=0.2)

        evm = chip("EVM Collection\nMultisig", MAGENTA, width=2.6, height=0.85)
        evm.move_to(ORIGIN)

        rec_label = Text("Recipients", font_size=BODY, color=WHITE, font=MONO)
        rec_label.to_edge(RIGHT, buff=0.6).shift(UP * 1.2)

        owner = chip("Machine Owner\n70%", BLUE, width=2.4, height=0.7)
        dev = chip("App Developer\n30%", PURPLE, width=2.4, height=0.7)
        recipients = VGroup(owner, dev)
        recipients.arrange(DOWN, buff=0.35)
        recipients.next_to(rec_label, DOWN, buff=0.2)

        weekly_arrow = Arrow(
            sources.get_right(), evm.get_left(),
            buff=0.15, color=MAGENTA, stroke_width=2.5
        )
        weekly_label = Text("Weekly collection", font_size=LABEL, color=MAGENTA, font=MONO)
        weekly_label.next_to(weekly_arrow, UP, buff=0.1)

        monthly_arrow = Arrow(
            evm.get_right(), recipients.get_left(),
            buff=0.15, color=PURPLE, stroke_width=2.5
        )
        monthly_label = Text("Monthly distribution", font_size=LABEL, color=PURPLE, font=MONO)
        monthly_label.next_to(monthly_arrow, UP, buff=0.1)

        self.play(Write(header), run_time=0.8)
        self.play(FadeIn(sources_label), FadeIn(sources), run_time=0.8)
        self.play(FadeIn(evm), run_time=0.6)
        self.play(FadeIn(rec_label), FadeIn(recipients), run_time=0.8)

        self.play(Create(weekly_arrow), Write(weekly_label), run_time=0.8)
        self.play(Create(monthly_arrow), Write(monthly_label), run_time=0.8)

        particles = VGroup(*[
            Dot(radius=0.06, color=YELLOW)
            for _ in range(12)
        ])

        for p in particles:
            p.move_to(sources.get_right())
            self.play(
                p.animate.move_to(evm.get_left()),
                run_time=0.6, rate_func=smooth
            )
            self.remove(p)

        self.wait(0.3)

        denial = Text(
            "48-hour denial window on every sweep",
            font_size=BODY, color=ORANGE, font=MONO
        )
        denial.to_edge(DOWN, buff=0.5)
        self.play(Write(denial), run_time=0.8)
        self.wait(1.2)

        self.play(FadeOut(VGroup(
            header, sources, sources_label, evm,
            recipients, rec_label, weekly_arrow, weekly_label,
            monthly_arrow, monthly_label, denial
        )), run_time=0.6)


class Scene6_DeployCTA(Scene):
    def construct(self):
        self.camera.background_color = BG

        header = Text("Deploy in One Command", font_size=HEADING, color=GREEN, font=MONO)
        header.to_edge(UP, buff=0.4)

        docker_box = RoundedRectangle(
            corner_radius=0.15, width=8, height=1.0,
            color=CYAN, fill_opacity=0.08, stroke_width=1
        )
        docker_cmd = Text("docker-compose up -d", font_size=BODY, color=CYAN, font=MONO)
        docker_cmd.move_to(docker_box.get_center())
        docker_group = VGroup(docker_box, docker_cmd)
        docker_group.shift(UP * 1.2)

        embed_box = RoundedRectangle(
            corner_radius=0.15, width=8, height=1.0,
            color=BLUE, fill_opacity=0.08, stroke_width=1
        )
        embed_cmd = Text(
            '<script src="..." data-app-id="..." auto-install>',
            font_size=CODE, color=BLUE, font=MONO
        )
        embed_cmd.move_to(embed_box.get_center())
        embed_group = VGroup(embed_box, embed_cmd)
        embed_group.shift(DOWN * 0.1)

        cross_text = Text(
            "Cross-platform: Docker desktop + embed on any device",
            font_size=BODY, color=MAGENTA, font=MONO
        )
        cross_text.shift(DOWN * 1.4)

        self.play(Write(header), run_time=0.8)
        self.play(FadeIn(docker_group), run_time=0.6)
        self.play(FadeIn(embed_group), run_time=0.6)
        self.play(Write(cross_text), run_time=0.6)
        self.wait(0.5)

        cta = Text(
            "github.com/TerexitariusStomp/qvac-chimera",
            font_size=BODY, color=GREEN, font=MONO
        )
        cta.to_edge(DOWN, buff=0.6)
        self.play(Write(cta), run_time=1.0)

        self.play(
            Circumscribe(cta, color=GREEN, time_width=0.4),
            run_time=1.2
        )
        self.wait(3.0)

        self.play(FadeOut(VGroup(
            header, docker_group, embed_group, cross_text, cta
        )), run_time=0.6)
