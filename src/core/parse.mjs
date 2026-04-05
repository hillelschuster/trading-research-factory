export function extractRfJson(text) {
  const match = text.match(/<RF_JSON>\s*([\s\S]*?)\s*<\/RF_JSON>/i);
  if (!match) throw new Error("Structured RF JSON block not found.");
  
  let jsonStr = match[1];
  
  // Fix common JSON escaping issues from model output
  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    // Try to fix escaped newlines that broke JSON
    jsonStr = jsonStr.replace(/,\s*}/g, '}').replace(/,\s*\]/g, ']');
    // Remove trailing commas
    jsonStr = jsonStr.replace(/,\s*([\]}])/g, '$1');
    // Try again
    try {
      return JSON.parse(jsonStr);
    } catch (e2) {
      throw new Error(`JSON parse failed: ${e.message}. Content: ${jsonStr.slice(0, 200)}`);
    }
  }
}
