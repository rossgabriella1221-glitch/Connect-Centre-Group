export const rubric = [
  { id: "greetings-verification", title: "Greetings and Verification of Caller's information", items: [
    q("g1", "Did the agent mention ‘Good morning/afternoon, thank you for calling Geneco’?", "standard", 9),
    q("g2", "Did the agent introduce themselves?", "standard", 13),
    q("g3", "Did the agent identify how the caller would like to be addressed?", "standard", 17),
    q("g4", "Did the agent perform full verification: two static and two dynamic questions?", "standard", 21, true)
  ]},
  { id: "effective-explanation", title: "Effective Explanation · Understand, Value and Verify customer concern", items: [
    q("e1", "Did the agent properly explain the solution to the caller?", "standard", 26),
    q("e2", "Did the agent take initiative to prompt the caller for information?", "standard", 30),
    q("e3", "Did the agent avoid excessive jargon, slang and acronyms?", "standard", 34),
    q("e4", "Did the agent make sure the caller was on the same page?", "standard", 38),
    q("e5", "When escalation was needed, did the agent explain the timeline?", "na", 42)
  ]},
  { id: "appropriate-resolution", title: "Appropriate Resolution · Understand, Help and Focus", items: [
    q("r1", "Did the agent offer the most accurate solution to meet the caller’s needs?", "standard", 47),
    q("r2", "Did the agent understand the caller’s question?", "standard", 51),
    q("r3", "Did the agent use appropriate questions to control the call?", "standard", 55)
  ]},
  { id: "professionalism", title: "Display Professionalism · Warm and attentive", items: [
    q("p1", "Did the agent address the caller professionally and communicate with a positive tone?", "standard", 60),
    q("p2", "Did the agent use first person throughout the call?", "standard", 64),
    q("p3", "Did the agent demonstrate active listening?", "standard", 68),
    q("p4", "Did the agent avoid rushing or cutting the caller off?", "reverse", 72),
    q("p5", "Did the agent show ownership in assisting the caller?", "standard", 76)
  ]},
  { id: "call-control", title: "Call Control and Conduct", items: [
    q("c1", "Did the agent avoid signs of frustration such as sighing or answering unhappily?", "reverse", 80, true),
    q("c2", "Did the agent use proper holding procedures?", "na", 84),
    q("c3", "Did the agent avoid excessive dead air?", "reverse", 88)
  ]},
  { id: "documentation", title: "Correct Documentation", items: [
    q("d1", "Did the agent log the case in CRM?", "standard", 93, true),
    q("d2", "Were the call details documented properly in CRM?", "standard", 97)
  ]},
  { id: "information-security", title: "Correct Information and Confidentiality", items: [
    q("i1", "Did the agent avoid disclosing confidential information?", "reverse", 102, true),
    q("i2", "Was the information given to the caller correct?", "standard", 106)
  ]},
  { id: "call-ending", title: "Call Ending · Feedback and comment", items: [
    q("x1", "Did the agent offer further assistance before ending the call?", "standard", 111),
    q("x2", "Did the agent use the required closing before ending the call?", "standard", 115),
    q("x3", "Did the agent avoid hanging up before the caller?", "reverse", 119),
    q("x4", "Did the agent actively ask the caller to participate in the after-call survey?", "na", 124)
  ]},
  { id: "major-violations", title: "Major Violations", items: [
    q("m1", "Did the agent avoid personal calls to friends or family?", "reverse", 129, true),
    q("m2", "Did the agent avoid inappropriate personal relationships, flirting or personal questions?", "reverse", 134, true),
    q("m3", "Did the agent avoid inappropriate language, rudeness, excessive interruption or intentional disconnection?", "reverse", 139, true),
    q("m4", "Did the agent avoid disparaging Geneco products or competitors?", "reverse", 144, true)
  ]},
  { id: "soft-skills", title: "Soft Skill · Care about customer", items: [
    q("s1", "Did the agent speak at a speed that was easy to follow and mirror the caller’s speech pattern?", "standard", 149),
    q("s2", "Did the agent show empathy and willingness to assist?", "standard", 153),
    q("s3", "Did the agent build rapport where appropriate?", "standard", 157),
    q("s4", "Did the agent use the caller’s preferred salutation throughout the call?", "standard", 161),
    q("s5", "Did the agent go the extra mile or personalize the service?", "standard", 165)
  ]},
  { id: "training-needs", title: "TM analysis on agent's training needs", items: [
    q("t1", "How was the agent’s overall soft skill?", "rating", 170),
    q("t2", "How was the agent’s product knowledge?", "rating", 174),
    q("t3", "Did the agent portray the Geneco brand personality: welcoming, confident and sincere?", "rating", 178)
  ]}
];

function q(id, text, type, sourceRow, critical = false) {
  return { id, text, type, sourceRow, critical, max: 5 };
}

export const flatRubric = rubric.flatMap(section => section.items.map(item => ({ ...item, sectionId: section.id, sectionTitle: section.title })));
export const maxScore = flatRubric.reduce((sum, item) => sum + item.max, 0);

export function normalizeScore(item, value) {
  const n = Number(value);
  if (item.type === "rating") return Math.max(1, Math.min(5, Number.isFinite(n) ? n : 1));
  if (value === "na") return 5;
  return n >= 3 ? 5 : 0;
}

export function calculate(results = []) {
  const byId = new Map(results.map(result => [result.id, result]));
  const sections = rubric.map(section => {
    const items = section.items.map(item => {
      const result = byId.get(item.id) || {};
      return { ...item, ...result, score: normalizeScore(item, result.score ?? 0) };
    });
    return { ...section, items, score: items.reduce((sum, item) => sum + item.score, 0), max: items.length * 5 };
  });
  const score = sections.reduce((sum, section) => sum + section.score, 0);
  return { score, max: maxScore, percentage: Math.round((score / maxScore) * 100), sections };
}
