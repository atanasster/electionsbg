import {
  GoogleGenAI,
  Tool,
  Chat,
  GenerateContentResponse,
  Content,
} from "@google/genai";
import * as electionService from "@/ai/services/electionService";
import * as locationService from "@/ai/services/locationService";
import { functionDeclarations } from "@/ai/services/fn_definitions";
import { Language } from "@/ai/constants";

if (!process.env.API_KEY) {
  throw new Error("API_KEY environment variable not set");
}

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
const availableTools: { [key: string]: Function } = {
  get_list_of_elections: electionService.get_list_of_elections,
  get_national_vote_type_summary:
    electionService.get_national_vote_type_summary,
  get_available_elections_for_year:
    electionService.get_available_elections_for_year,
  get_election_results: electionService.get_election_results,
  get_turnout_statistics: electionService.get_turnout_statistics,
  get_vote_adoption_by_region: electionService.get_vote_adoption_by_region,
  get_new_parties: electionService.get_new_parties,
  get_candidate_performance: electionService.get_candidate_performance,
  find_preference_anomalies: electionService.find_preference_anomalies,
  get_campaign_finances: electionService.get_campaign_finances,
  get_top_donors: electionService.get_top_donors,
  get_total_state_subsidy: electionService.get_total_state_subsidy,
  compare_election_results: electionService.compare_election_results,
  compare_campaign_finances: electionService.compare_campaign_finances,
  find_voting_discrepancies: electionService.find_voting_discrepancies,
  find_discrepancies_between_vote_types:
    electionService.find_discrepancies_between_vote_types,
  calculate_campaign_efficiency: electionService.calculate_campaign_efficiency,
  suggest_campaign_focus_areas: electionService.suggest_campaign_focus_areas,
  find_stations_with_high_invalid_ballots:
    electionService.find_stations_with_high_invalid_ballots,
  find_stations_with_high_additional_voters:
    electionService.find_stations_with_high_additional_voters,
  get_aggregated_additional_voters:
    electionService.get_aggregated_additional_voters,
  get_none_of_the_above_stats: electionService.get_none_of_the_above_stats,
  get_ballot_summary: electionService.get_ballot_summary,
  get_party_info: electionService.get_party_info,
  find_machine_vote_discrepancies:
    electionService.find_machine_vote_discrepancies,
  get_list_of_regions: locationService.get_list_of_regions,
};

const tools: Tool[] = [{ functionDeclarations }];

const getSystemInstruction = (language: Language): string => {
  const isEnglish = language === "en";
  const disclaimer = isEnglish
    ? "Disclaimer: This information is from my general knowledge, not the specialized election database."
    : "Отказ от отговорност: Тази информация е от общите ми познания, а не от специализираната база данни за изборите.";

  return `You are CIK-AI, an expert assistant for Bulgarian election data. Your responses must be in ${isEnglish ? "English" : "Bulgarian"}.

**Core Instructions:**
1.  **Tool-First Approach:** Always prioritize using your tools. For complex queries, call functions sequentially to gather ALL necessary data *before* formulating your final text response. Do not explain your plan; execute the function calls first.
2.  **Clean Final Output:** Your final response to the user must be clean natural language. Function call results are wrapped (e.g., \`{"content": ...}\`). Use the data inside 'content', but you MUST NOT include any raw JSON, function response structures (e.g., \`{"..._response": ...}\`), or the 'content' wrapper in your final output.
3.  **Handling Dates:** For relative dates like "last election," you MUST first call \`get_list_of_elections\` to get the correct election \`identifier\`(s), then use those identifiers in subsequent function calls.
4.  **Tool Data Handling & Summaries:** When asked to "summarize" an election, provide a comprehensive overview.
    *   First, call \`get_turnout_statistics\` to get voter turnout, total registered voters, and votes from additional lists.
    *   Call \`get_ballot_summary\` to get the total valid votes.
    *   Present these key statistics clearly, for example in a bulleted list.
    *   When using \`get_list_of_elections\`, use the language-appropriate name ('en' or 'bg'). The boolean flags (\`hasRecount\`, \`hasSuemg\`, etc.) indicate what data is available; you can mention this availability as part of a detailed summary.
5.  **Location Queries:** You have access to a complete list of Bulgarian administrative regions via the \`get_list_of_regions\` tool. When a user asks about a location, your tools will handle the necessary lookups. Note that Sofia city is a special case and corresponds to three electoral regions ('S23', 'S24', 'S25'). Currently, detailed results (like vote counts and turnout) are primarily available at the national level.
6.  **Out-of-Scope Questions:** If a question is unrelated to Bulgarian elections and no tool applies, answer from your general knowledge but you MUST start your response with: "${disclaimer}".
7.  **Response Formatting:**
    *   **Tables are Mandatory:** Present any lists, comparisons, or multi-item data in a Markdown table.
    *   **Comparison Tables:** When comparing results across elections, create a table with a column for each election, plus calculated 'Change' and '% Change' columns.
    *   **Internal Links:** Make entities interactive by formatting them as links. You MUST URL-encode entity names in the path.
        - General format: \`[Entity Name](/query/type/Encoded%20Entity%20Name)\`.
        - **Location format (MANDATORY)**: \`[Location Name](/query/location/type/Encoded%20Location%20Name)\` where 'type' is one of 'region', 'municipality', or 'settlement'.
        - This applies to parties, elections, locations, candidates, and stations.
    *   **Normalization:** Normalize Bulgarian location names (e.g., 'Sofiq' -> 'Sofia') in function calls and in generated link paths.`;
};

export const createChat = (language: Language): Chat => {
  return ai.chats.create({
    model: "gemini-2.5-flash",
    config: {
      tools: tools,
      systemInstruction: getSystemInstruction(language),
    },
  });
};

export const createChatWithHistory = (
  language: Language,
  history: Content[],
): Chat => {
  return ai.chats.create({
    model: "gemini-2.5-flash",
    config: {
      tools: tools,
      systemInstruction: getSystemInstruction(language),
    },
    history,
  });
};

export const sendMessage = async (
  chat: Chat,
  message: string,
  isCancelledRef: { current: boolean },
): Promise<GenerateContentResponse> => {
  if (isCancelledRef.current) throw new Error("GENERATION_CANCELLED");
  let response = await chat.sendMessage({ message });

  while (response.candidates?.[0]?.content?.parts?.[0]?.functionCall) {
    if (isCancelledRef.current) throw new Error("GENERATION_CANCELLED");

    const functionCall = response.candidates[0].content.parts[0].functionCall;
    const { name, args } = functionCall;

    console.log(`Model wants to call ${name} with args:`, args);

    if (name && availableTools[name]) {
      const tool = availableTools[name];
      try {
        const result = await tool(args);
        console.log(`Function ${name} returned:`, result);

        if (isCancelledRef.current) throw new Error("GENERATION_CANCELLED");
        response = await chat.sendMessage({
          message: [
            { functionResponse: { name, response: { content: result } } },
          ],
        });
      } catch (e) {
        console.error(`Error calling function ${name}:`, e);
        const errorResult = {
          error: `Function call failed: ${(e as Error).message}`,
        };
        response = await chat.sendMessage({
          message: [
            { functionResponse: { name, response: { content: errorResult } } },
          ],
        });
      }
    } else {
      console.error(`Unknown function ${name} called by model.`);
      const errorResult = { error: `Function ${name} not found.` };
      response = await chat.sendMessage({
        message: [
          { functionResponse: { name, response: { content: errorResult } } },
        ],
      });
    }
  }

  return response;
};
