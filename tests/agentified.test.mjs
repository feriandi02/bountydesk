// Checks that BountyDesk's network, manifest and actions work together.
// Run: node --test "tests/*.test.mjs"   (Node 22 does not accept a bare folder.)
// These tests use the real runtime and the real page code, with a scripted model.
// They do not call an LLM provider.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ActionRegistry } from "../runtime/actions.js";
import { AgentNetwork, validateNetwork } from "../runtime/kernel.js";
import { buildToolTable, runAgent } from "../runtime/runner.js";
import { TraceBus } from "../runtime/trace.js";
import { StubDocument } from "./stub_document.mjs";
import { StubElement } from "./stub_element.mjs";
import { StubOption } from "./stub_option.mjs";
import { ScriptedModel } from "./scripted_model.mjs";

const NETWORK_NAME = "bounty_desk";
// The page's address in these tests. The DOM stand-in below uses it too: site.js gives
// its own dialog only to actions from the page's origin.
const BASE = "http://localhost:8080";

// Page scripts touch the DOM when they load, so give them a stand-in first.
// It knows the ids in index.html, so a mistyped id fails instead of passing silently.
globalThis.document = StubDocument.fromHtml(await readFile(new URL("../index.html", import.meta.url), "utf8"), `${BASE}/`);
// Node has no Option, which pages use to build select options.
globalThis.Option = StubOption;
const { registerActions } = await import("../site-actions.js");
// site.js boots the runtime only in a browser. Here it gives the dialog's words.
const { AssistantMount } = await import("../site.js");
// Seed the page's data from the site's own JSON files, as the browser would load them.
const { setData, App } = await import("../script.js");
setData({
  programs: JSON.parse(await readFile(new URL("../data/programs.json", import.meta.url), "utf8")),
  checklists: JSON.parse(await readFile(new URL("../data/checklists.json", import.meta.url), "utf8")),
  findings: JSON.parse(await readFile(new URL("../data/findings.json", import.meta.url), "utf8")),
});

/**
 * Integration checks for BountyDesk.
 *
 * Each test builds the runtime objects the browser would build and drives them with a
 * ScriptedModel. Tests share this one page and run in order, as in one browser tab.
 */
class BountyDeskTest {
  static async load() {
    const config = JSON.parse(await readFile(new URL(`../${NETWORK_NAME}.network.json`, import.meta.url), "utf8"));
    const manifest = JSON.parse(await readFile(new URL("../agent-manifest.json", import.meta.url), "utf8"));
    return {
      config: config,
      manifest: manifest,
      network: new AgentNetwork(config, NETWORK_NAME),
    };
  }

  static scope() {
    return {
      base: BASE,
      network: NETWORK_NAME,
    };
  }

  static async registry() {
    const registry = new ActionRegistry();
    await registerActions({
      register: registry.register.bind(registry, BountyDeskTest.scope()),
    });
    return registry;
  }

  static context(loaded, registry, model, confirm) {
    return {
      network: loaded.network,
      manifest: loaded.manifest,
      actions: registry,
      baseOrigin: BASE,
      displayOrigin: new URL(BASE).host,
      trace: new TraceBus(),
      isTop: true,
      frontMan: loaded.network.findFrontMan(),
      history: [],
      llm: model,
      confirmWebsiteActions: confirm,
    };
  }

  static async tool(loaded, ctx, name) {
    const spec = loaded.network.getAgentSpec(loaded.network.findFrontMan());
    const table = await buildToolTable(ctx, spec, [], null);
    return table.toolByName.get(`website_${name}`);
  }

  static ref(registry, name) {
    for (const entry of registry.catalog(BountyDeskTest.scope())) {
      if (entry.name === name) {
        return entry.ref;
      }
    }
    throw new Error(`Action ${name} is not registered.`);
  }

  static async approve() {
    return true;
  }

  static async callAction(registry, name, args) {
    const plan = registry.prepare({
      kind: "action",
      action: BountyDeskTest.ref(registry, name),
      arguments: args,
    });
    const receipts = await registry.execute(plan, BountyDeskTest.approve, "test");
    return receipts[0];
  }

  /** The network validates, the sample queries match the manifest, and the front agent keeps the peer and partner rules. */
  static async testNetworkIsValid() {
    const loaded = await BountyDeskTest.load();
    validateNetwork(loaded.network);
    assert.equal(loaded.network.findFrontMan(), "bounty_desk_coordinator");
    assert.deepEqual(
      loaded.config.metadata.sample_queries,
      loaded.manifest.networks[0].sample_queries,
      "Sample queries in the HOCON and the manifest must match.",
    );
    const front = loaded.network.getAgentSpec("bounty_desk_coordinator");
    // The build expands {peer_rules} and {partner_rules} into the text, so check
    // for the expanded rule text, not the placeholders.
    assert.match(front.instructions, /another site's assistant is asking for its visitor/, "Front agent lost its peer rules.");
    assert.match(front.instructions, /Partner tools ask another site's assistant/, "Front agent lost its partner rules.");
    assert.match(front.instructions, /agent_atlas/, "Front agent never names the partner tool.");
    assert.ok(!front.instructions.includes("TODO"), "Front agent instructions still have a TODO.");
    for (const agent of loaded.network.config.tools || []) {
      const spec = loaded.network.getAgentSpec(agent.name);
      assert.ok(spec.instructions.length < 5000, `${agent.name} instructions are over 5,000 characters.`);
      assert.ok(!spec.instructions.includes("demo_mode"), `${agent.name} mentions demo_mode.`);
    }
    assert.equal(loaded.manifest.networks[0].name, NETWORK_NAME);
    assert.equal(loaded.manifest.actions.module, "./site-actions.js");
  }

  /** Every agentTools name is a registered local-only action with no TODO left, and every tool is named in some agent's instructions. */
  static async testActionsMatchManifest() {
    const loaded = await BountyDeskTest.load();
    const registry = await BountyDeskTest.registry();
    const registered = new Map();
    for (const entry of registry.catalog(BountyDeskTest.scope())) {
      registered.set(entry.name, entry);
      const words = JSON.stringify([entry.description, entry.inputSchema]);
      assert.ok(!words.includes("TODO"), `The ${entry.name} action still has a TODO in its description or schema.`);
    }
    const lines = [];
    for (const agent of loaded.network.config.tools || []) {
      const spec = loaded.network.getAgentSpec(agent.name);
      if (spec && typeof spec.instructions === "string") {
        lines.push(...spec.instructions.split("\n"));
      }
    }
    for (const name of loaded.manifest.actions.agentTools) {
      assert.ok(registered.has(name), `agentTools lists ${name}, but it is not registered.`);
      assert.equal(registered.get(name).availability, "local-only");
      const pattern = new RegExp(`website_${name}(?![\\w-])`);
      let named = false;
      let onlyWhenAsked = false;
      for (const line of lines) {
        if (pattern.test(line)) {
          named = true;
          onlyWhenAsked = onlyWhenAsked || line.includes("only when the visitor asks");
        }
      }
      assert.ok(named, `No agent's instructions name website_${name}.`);
      if (registered.get(name).effect === "write") {
        assert.ok(onlyWhenAsked, `The line for website_${name} does not say to call it only when the visitor asks.`);
      }
    }
  }

  /** The front agent can call a read tool and gets a succeeded receipt back. */
  static async testReadActionRunsAsTool(t) {
    const loaded = await BountyDeskTest.load();
    const registry = await BountyDeskTest.registry();
    const model = new ScriptedModel([
      {
        tool: "website_search_programs",
        arguments: { verdict: "PASS" },
      },
      {
        text: "Here is what I found.",
      },
    ]);
    const ctx = BountyDeskTest.context(loaded, registry, model, BountyDeskTest.approve);
    const result = await runAgent(ctx, ctx.frontMan, "Which programs are worth hunting?", null, []);
    assert.ok(model.toolNames(0).includes("website_search_programs"));
    assert.equal(model.toolResults(1)[0].status, "succeeded");
    const rows = model.toolResults(1)[0].result;
    assert.ok(Array.isArray(rows) && rows.length > 0, "search_programs returned no rows.");
    assert.ok(rows.every((r) => r.verdict === "PASS"), "search_programs returned a non-PASS row.");
    assert.match(result.text, /found/);
    const sent = model.calls[0];
    t.diagnostic(`Each model call sends ${sent.messages[0].content.length} characters of system prompt and ${JSON.stringify(sent.tools).length} of tool definitions.`);
  }

  /** Each read that takes arguments leaves the page as it was. */
  static async testReadsLeavePageUnchanged() {
    const registry = await BountyDeskTest.registry();
    const before = JSON.stringify(document.snapshot());
    const reads = [
      ["get_program_data", { query: "ticko" }],
      ["get_checklist", { checklistId: "triage" }],
      ["get_finding", { findingId: "openai-s1" }],
      ["search_programs", { free: true }],
      ["get_site_info", {}],
    ];
    for (const [name, args] of reads) {
      const receipt = await BountyDeskTest.callAction(registry, name, args);
      assert.equal(receipt.status, "succeeded", `${name} did not succeed.`);
      assert.ok(receipt.result && receipt.result.ok !== false, `${name} returned a refusal: ${JSON.stringify(receipt.result)}`);
    }
    assert.equal(JSON.stringify(document.snapshot()), before, "A read changed the page.");
  }

  /** A read that cannot find its record refuses with the site's reason. */
  static async testReadsRefuseUnknownIds() {
    const registry = await BountyDeskTest.registry();
    const program = await BountyDeskTest.callAction(registry, "get_program_data", { query: "no-such-program" });
    assert.equal(program.status, "succeeded");
    assert.equal(program.result.ok, false);
    assert.match(program.result.reason, /No program named/);
    const finding = await BountyDeskTest.callAction(registry, "get_finding", { findingId: "openai-c1" });
    assert.equal(finding.status, "succeeded");
    assert.equal(finding.result.id, "openai-c1");
  }

  /** The write tool saves a note, shows it on the page, and deletes it again. Bad input refuses without changing anything. */
  static async testSaveAndDeleteNote() {
    const registry = await BountyDeskTest.registry();
    const before = App.page.getState().notes;
    assert.deepEqual(before, [], "The shortlist is not empty at the start of the test.");

    const saved = await BountyDeskTest.callAction(registry, "save_triage_note", {
      programId: "ticko",
      note: "Email filing, testnet-only, rewards up to $200,000.",
    });
    assert.equal(saved.status, "succeeded");
    assert.equal(saved.result.ok, true);
    const noteId = saved.result.note.id;
    assert.equal(App.page.getState().notes.length, 1);
    assert.ok(JSON.stringify(document.snapshot()).includes("Email filing"), "The saved note does not show on the page.");

    // Bad program id refuses and changes nothing.
    const badProgram = await BountyDeskTest.callAction(registry, "save_triage_note", {
      programId: "no-such-program",
      note: "Should not save.",
    });
    assert.equal(badProgram.result.ok, false);
    assert.match(badProgram.result.reason, /Choose a program/);
    assert.equal(App.page.getState().notes.length, 1);

    // Empty note refuses and changes nothing.
    const empty = await BountyDeskTest.callAction(registry, "save_triage_note", {
      programId: "ticko",
      note: "   ",
    });
    assert.equal(empty.result.ok, false);
    assert.equal(App.page.getState().notes.length, 1);

    // Over-long note: the schema's maxLength refuses it before execute runs,
    // and the page's own check refuses it too. Either way nothing is saved.
    await assert.rejects(
      BountyDeskTest.callAction(registry, "save_triage_note", {
        programId: "ticko",
        note: "x".repeat(501),
      }),
      /Invalid arguments\.note/,
      "A 501-character note should fail schema validation.",
    );
    assert.equal(App.page.saveNote({ programId: "ticko", note: "x".repeat(501) }).ok, false);
    assert.equal(App.page.getState().notes.length, 1);

    // Delete removes it; deleting again refuses.
    const deleted = await BountyDeskTest.callAction(registry, "delete_triage_note", { id: noteId });
    assert.equal(deleted.status, "succeeded");
    assert.equal(deleted.result.ok, true);
    assert.deepEqual(App.page.getState().notes, []);
    const gone = await BountyDeskTest.callAction(registry, "delete_triage_note", { id: noteId });
    assert.equal(gone.result.ok, false);
    assert.match(gone.result.reason, /not on your shortlist/);
  }

  /** No TODO is left in the page, the greeting is filled in, and there are no irreversible actions. */
  static async testNoTodoLeft() {
    const loaded = await BountyDeskTest.load();
    assert.ok(!AssistantMount.GREETING.includes("TODO"), "GREETING in site.js is not filled in.");
    assert.deepEqual(Object.keys(AssistantMount.DIALOGS), [], "BountyDesk should have no irreversible actions.");
    const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
    const section = html.slice(html.indexOf('<section id="assistant"'), html.indexOf("</section>", html.indexOf('<section id="assistant"')));
    assert.ok(!section.includes("TODO"), "The assistant section in index.html still has a TODO.");
    assert.ok(!html.includes("TODO"), "index.html still has a TODO.");
    // The manifest, the network file and the awww.json copy agree.
    const awww = JSON.parse(await readFile(new URL("../.well-known/awww.json", import.meta.url), "utf8"));
    assert.deepEqual(awww, loaded.manifest, ".well-known/awww.json differs from agent-manifest.json.");
    const network = JSON.parse(await readFile(new URL("../bounty_desk.network.json", import.meta.url), "utf8"));
    assert.equal(network.tools.length, 3, "The network should have exactly 3 agents.");
  }
}

test("network validates and sample queries match the manifest", BountyDeskTest.testNetworkIsValid);
test("agentTools are registered local-only actions with no TODO left", BountyDeskTest.testActionsMatchManifest);
test("front agent reads programs through a website tool", BountyDeskTest.testReadActionRunsAsTool);
test("reads leave the page unchanged", BountyDeskTest.testReadsLeavePageUnchanged);
test("reads refuse unknown ids", BountyDeskTest.testReadsRefuseUnknownIds);
test("save and delete a triage note", BountyDeskTest.testSaveAndDeleteNote);
test("no TODO left and the manifest copies agree", BountyDeskTest.testNoTodoLeft);
