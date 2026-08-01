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
