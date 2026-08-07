import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { planToTickets, EXIT_APPROVED, EXIT_CANCELLED, EXIT_ERRORED } from "../review.ts";

describe("planToTickets", () => {
  test("skips a lone document title but keeps section headings", () => {
    const tickets = planToTickets("# The plan\n\n## Do the work\n\n- Something.\n");
    assert.deepEqual(
      tickets.map((t) => t.title),
      ["Do the work", "Something."],
    );
  });

  test("keeps every top-level heading when there is no single title", () => {
    const tickets = planToTickets("# First\n\ntext\n\n# Second\n\ntext\n");
    assert.deepEqual(
      tickets.map((t) => t.title),
      ["First", "Second"],
    );
  });

  test("treats prose sections as context rather than work", () => {
    const tickets = planToTickets(
      "# T\n\n## Problem\n\n- not work\n\n## Non-goals\n\n- also not work\n\n## Build it\n\n- work\n",
    );
    assert.deepEqual(
      tickets.map((t) => t.title),
      ["Build it", "work"],
    );
  });

  test("parents steps to the heading they sit under", () => {
    const tickets = planToTickets("# T\n\n## Ship\n\n1. One.\n2. Two.\n");
    assert.equal(tickets[0].parent, undefined);
    assert.equal(tickets[1].parent, 0);
    assert.equal(tickets[2].parent, 0);
  });

  test("chains numbered steps, because a numbered plan is an order", () => {
    const tickets = planToTickets("# T\n\n## Ship\n\n1. One.\n2. Two.\n3. Three.\n");
    assert.deepEqual(tickets[1].deps, []);
    assert.deepEqual(tickets[2].deps, [1]);
    assert.deepEqual(tickets[3].deps, [2]);
  });

  test("leaves bullets unordered, because a bullet list is a set", () => {
    const tickets = planToTickets("# T\n\n## Ship\n\n- One.\n- Two.\n- Three.\n");
    for (const ticket of tickets.slice(1)) assert.deepEqual(ticket.deps, []);
  });

  test("ignores list-like lines inside fenced code", () => {
    const plan = "# T\n\n## Ship\n\n```\n1. not a step\n- not a step\n```\n\n1. a real step\n";
    const tickets = planToTickets(plan);
    assert.deepEqual(
      tickets.map((t) => t.title),
      ["Ship", "a real step"],
    );
  });

  test("ignores headings inside fenced code", () => {
    const tickets = planToTickets("# T\n\n## Ship\n\n```\n## not a heading\n```\n\n- step\n");
    assert.deepEqual(
      tickets.map((t) => t.title),
      ["Ship", "step"],
    );
  });

  test("strips inline markdown so a title reads as prose", () => {
    const tickets = planToTickets("# T\n\n## Ship\n\n- Run `the backfill` and **verify** it.\n");
    assert.equal(tickets[1].title, "Run the backfill and verify it.");
  });

  test("does not promote nested items to their own tickets", () => {
    const tickets = planToTickets("# T\n\n## Ship\n\n1. Top.\n   - detail\n   - detail\n2. Next.\n");
    assert.deepEqual(
      tickets.map((t) => t.title),
      ["Ship", "Top.", "Next."],
    );
  });

  test("carries prose as the body when a heading has no steps", () => {
    const tickets = planToTickets("# T\n\n## Ship\n\nJust a paragraph.\n");
    assert.equal(tickets.length, 1);
    assert.match(tickets[0].body ?? "", /Just a paragraph\./);
  });

  test("produces nothing from a plan with no sections", () => {
    assert.deepEqual(planToTickets("# Only a title\n"), []);
  });
});

describe("planToTickets — soft-wrapped steps", () => {
  test("a step wrapped across lines keeps its whole sentence", () => {
    // A plan is soft-wrapped markdown. Reading only the line carrying the
    // marker truncated eleven titles mid-sentence in one real run — an agent
    // given "…obstacle set from" has half an instruction and no way to know it.
    const tickets = planToTickets(
      "# Plan\n\n## M1\n\n" +
        "1. Build the obstacle set from the tileset and wire it into the collision\n" +
        "   layer so the player cannot walk through the fence.\n" +
        "2. Add a fallback branch.\n",
    );

    assert.equal(
      tickets[1].title,
      "Build the obstacle set from the tileset and wire it into the collision layer so the player cannot walk through the fence.",
    );
    assert.equal(tickets[2].title, "Add a fallback branch.");
  });

  test("folds several continuation lines, collapsing the wrap to single spaces", () => {
    const tickets = planToTickets(
      "# Plan\n\n## M1\n\n- One sentence that\n  runs over\n  three lines.\n",
    );

    assert.equal(tickets[1].title, "One sentence that runs over three lines.");
  });

  test("a nested list under a step is that step's detail, not a lost line", () => {
    const tickets = planToTickets(
      "# Plan\n\n## M1\n\n1. Re-theme the map.\n   - Keep the palette.\n   - Do not move spawn.\n",
    );

    assert.equal(tickets.length, 2);
    assert.equal(tickets[1].title, "Re-theme the map.");
    assert.equal(tickets[1].body, "- Keep the palette.\n- Do not move spawn.");
  });

  test("a blank line between items still chains them — loose lists are lists", () => {
    const tickets = planToTickets("# Plan\n\n## M1\n\n1. First.\n\n2. Second.\n\n3. Third.\n");

    assert.deepEqual(
      tickets.slice(1).map((t) => t.title),
      ["First.", "Second.", "Third."],
    );
    assert.deepEqual(tickets[2].deps, [1]);
    assert.deepEqual(tickets[3].deps, [2]);
  });

  test("prose after a list does not become part of the last step", () => {
    const tickets = planToTickets(
      "# Plan\n\n## M1\n\n1. Do the thing.\n\nThis paragraph is commentary.\n\n- And a later bullet.\n",
    );

    assert.equal(tickets[1].title, "Do the thing.");
    assert.equal(tickets[2].title, "And a later bullet.");
  });

  test("a wrapped line inside a fenced block is still not a step", () => {
    const tickets = planToTickets(
      "# Plan\n\n## M1\n\n1. Real step.\n\n```\n1. Not a step\n   continued\n```\n",
    );

    assert.deepEqual(
      tickets.slice(1).map((t) => t.title),
      ["Real step."],
    );
  });
});

describe("exit codes", () => {
  test("are distinct so a parent can branch on them", () => {
    const codes = [EXIT_APPROVED, EXIT_CANCELLED, EXIT_ERRORED];
    assert.equal(new Set(codes).size, 3);
  });

  test("use zero only for approval", () => {
    assert.equal(EXIT_APPROVED, 0);
    assert.notEqual(EXIT_CANCELLED, 0);
    assert.notEqual(EXIT_ERRORED, 0);
  });

  test("keep 1 free for startup failure", () => {
    assert.ok(![EXIT_APPROVED, EXIT_CANCELLED, EXIT_ERRORED].includes(1));
  });
});

describe("what review debris costs, measured", () => {
  /*
   * These pin the claims the approve dialog's verification pass makes to the
   * reviewer. A warning whose stated reason is false is worse than no warning,
   * so the words there are checked against what the shatter actually does.
   */
  test("makes no ticket at all from an empty list item", () => {
    const tickets = planToTickets("# Plan\n\n## M1\n\n1. A real step.\n2.\n-\n3. Another step.\n");

    assert.deepEqual(
      tickets.map((t) => t.title),
      ["M1", "A real step.", "Another step."],
    );
  });

  test("skips an empty heading and hands its steps to the milestone above", () => {
    // The serious one: the work does not vanish, it silently lands under the
    // wrong heading, which is far harder to notice than a missing ticket.
    const tickets = planToTickets(
      "# Plan\n\n## M1 — Ride in\n\n1. A real step.\n\n##\n\n1. Orphaned step.\n",
    );

    assert.deepEqual(
      tickets.map((t) => [t.title, t.parent]),
      [
        ["M1 — Ride in", undefined],
        ["A real step.", 0],
        ["Orphaned step.", 0],
      ],
    );
  });

  test("loses every heading below an unclosed fence", () => {
    const tickets = planToTickets(
      "# Plan\n\n## M1\n\n1. A real step.\n\n```sh\nquill PLAN.md\n\n## M2\n\n1. Never becomes work.\n",
    );

    assert.deepEqual(
      tickets.map((t) => t.title),
      ["M1", "A real step."],
    );
  });
});
