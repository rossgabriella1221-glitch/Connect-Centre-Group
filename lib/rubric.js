export const rubric = [
  { id: "greetings-verification", title: "Greetings and Verification of Caller's information", items: [
    q("g1", "Did the agent answer the call within 3 rings (or within KPI)?", "standard"), q("g2", "Did the agent mention ‘Thank you for calling [Project Name]’?", "standard"), q("g3", "Did the agent introduce themselves?", "standard"), q("g4", "Did the agent offer assistance?", "standard"), q("g5", "Did the agent verify the caller’s name?", "standard"), q("g6", "Did the agent verify contact details?", "standard")
  ]},
  { id: "effective-explanation", title: "Effective Explanation", items: [
    q("e1", "Did the agent take initiative to prompt the caller for information?", "standard"), q("e2", "Did the agent avoid excessive jargon during the call?", "reverse"), q("e3", "When escalation was needed, did the agent explain the process to the caller?", "na"), q("e4", "Did the agent properly offer a solution to the call?", "standard")
  ]},
  { id: "appropriate-resolution", title: "Appropriate Resolution", items: [
    q("r1", "Did the agent understand the caller’s question?", "standard"), q("r2", "Did the agent use appropriate questions to control the call?", "standard"), q("r3", "Did the agent offer the most accurate solution to meet the caller’s needs?", "standard")
  ]},
  { id: "professionalism", title: "Display Professionalism", items: [
    q("p1", "Did the agent address the caller professionally and communicate with a positive tone?", "standard"), q("p2", "Did the agent demonstrate active listening during the call?", "standard"), q("p3", "Did the agent avoid rushing or cutting the caller off?", "reverse"), q("p4", "Did the agent avoid excessive dead air during the call?", "reverse"), q("p5", "Did the agent avoid signs of frustration such as sighing or answering unhappily?", "reverse", true), q("p6", "Did the agent use proper holding procedures?", "na"), q("p7", "Did the agent show ownership in assisting the caller?", "na")
  ]},
  { id: "call-ending", title: "Call Ending", items: [
    q("c1", "Did the agent offer further assistance before ending the call?", "standard"), q("c2", "Did the agent use the required closing before ending the call?", "standard")
  ]},
  { id: "documentation", title: "Correct Documentation", items: [
    q("d1", "Were the call details documented properly in CRM?", "documentation"), q("d2", "Did the agent avoid disclosing a contact number that should not have been disclosed?", "reverse", true), q("d3", "Was the information given to the caller correct?", "standard", true)
  ]},
  { id: "major-violations", title: "Major Violations", items: [
    q("m1", "Did the agent avoid an inappropriate personal relationship, flirting or personal questions?", "reverse"), q("m2", "Did the agent avoid personal calls to friends or family?", "reverse"), q("m3", "Did the agent avoid inappropriate language, rudeness, excessive interruption or intentional disconnection?", "reverse")
  ]},
  { id: "training-needs", title: "TM analysis on agent's training needs", items: [
    q("t1", "How was the agent’s product knowledge?", "rating"), q("t2", "How was the agent’s overall soft skill?", "rating")
  ]}
];

function q(id, text, type, critical = false) { return { id, text, type, critical, max: 5 }; }
export const flatRubric = rubric.flatMap(section => section.items.map(item => ({ ...item, sectionId: section.id, sectionTitle: section.title })));
export const fullMaxScore = flatRubric.length * 5;

export function normalizeResult(item, value) {
  if (value === "na") return { score: 0, applicable: false };
  const n = Number(value);
  if (item.type === "rating") return { score: Math.max(1, Math.min(5, Number.isFinite(n) ? n : 1)), applicable: true };
  if (item.type === "documentation") return { score: n >= 3 ? 5 : 1, applicable: true };
  return { score: n >= 3 ? 5 : 0, applicable: true };
}

export function calculate(results = []) {
  const byId = new Map(results.map(result => [result.id, result]));
  const sections = rubric.map(section => {
    const items = section.items.map(item => { const result = byId.get(item.id) || {}; return { ...item, ...result, ...normalizeResult(item, result.score ?? 0) }; });
    return { ...section, items, score: items.reduce((sum, item) => sum + item.score, 0), max: items.reduce((sum, item) => sum + (item.applicable ? 5 : 0), 0) };
  });
  const score = sections.reduce((sum, section) => sum + section.score, 0);
  const max = sections.reduce((sum, section) => sum + section.max, 0);
  return { score, max, percentage: max ? Number(((score / max) * 100).toFixed(2)) : 0, sections };
}
