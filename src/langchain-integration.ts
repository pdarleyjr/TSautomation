import { ChatOpenAI } from '@langchain/openai';
import { PromptTemplate } from '@langchain/core/prompts';
import { LLMChain } from 'langchain/chains';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { OpenAIEmbeddings } from '@langchain/openai';
import { MemoryVectorStore } from 'langchain/vectorstores/memory';
import { RetrievalQAChain, loadQAStuffChain } from 'langchain/chains';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Configuration
const config = {
  openaiApiKey: process.env.OPENAI_API_KEY,
  modelName: process.env.OPENAI_MODEL_NAME || 'gpt-3.5-turbo',
  temperature: parseFloat(process.env.OPENAI_TEMPERATURE || '0.3'),
  maxTokens: parseInt(process.env.OPENAI_MAX_TOKENS || '2000'),
  chunkSize: parseInt(process.env.CHUNK_SIZE || '1000'),
  chunkOverlap: parseInt(process.env.CHUNK_OVERLAP || '200'),
};

/**
 * Initialize the LangChain model
 */
export function initializeLLM() {
  return new ChatOpenAI({
    openAIApiKey: config.openaiApiKey,
    modelName: config.modelName,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
  });
}

/**
 * Split course content into manageable chunks for processing
 * @param courseContent The full course content text
 * @returns Array of content chunks
 */
export async function splitCourseContent(courseContent: string): Promise<string[]> {
  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: config.chunkSize,
    chunkOverlap: config.chunkOverlap,
  });
  
  return await textSplitter.splitText(courseContent);
}

/**
 * Create a vector store from course content for semantic search
 * @param courseContent The full course content text
 * @returns MemoryVectorStore instance
 */
export async function createVectorStore(courseContent: string): Promise<MemoryVectorStore> {
  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: config.chunkSize,
    chunkOverlap: config.chunkOverlap,
  });
  
  const docs = await textSplitter.createDocuments([courseContent]);
  const embeddings = new OpenAIEmbeddings({
    openAIApiKey: config.openaiApiKey,
  });
  
  return await MemoryVectorStore.fromDocuments(docs, embeddings);
}

/**
 * Answer a question using the course content
 * @param question The question to answer
 * @param courseContent The course content to use as context
 * @returns The answer to the question
 */
export async function answerQuestion(question: string, courseContent: string): Promise<string> {
  const llm = initializeLLM();
  
  // For simple questions, use a direct approach
  if (question.length < 100 && courseContent.length < 4000) {
    const template = `
    Based on the following course material:
    {courseContent}
    
    Please answer this question: {question}
    
    Provide only the answer, no explanations.
    `;
    
    const promptTemplate = new PromptTemplate({
      template,
      inputVariables: ['courseContent', 'question'],
    });
    
    const chain = new LLMChain({ llm, prompt: promptTemplate });
    const result = await chain.call({
      courseContent,
      question,
    });
    
    return result.text;
  }
  
  // For more complex questions or longer content, use retrieval QA
  const vectorStore = await createVectorStore(courseContent);
  const retriever = vectorStore.asRetriever();
  
  const qaChain = new RetrievalQAChain({
    combineDocumentsChain: loadQAStuffChain(llm),
    retriever,
  });
  
  const result = await qaChain.call({
    query: question,
  });
  
  return result.text;
}

/**
 * Summarize course content
 * @param courseContent The course content to summarize
 * @returns A summary of the course content
 */
export async function summarizeCourseContent(courseContent: string): Promise<string> {
  const llm = initializeLLM();
  
  // If content is short, summarize directly
  if (courseContent.length < 4000) {
    const template = `
    Summarize the following course material in a concise way:
    {courseContent}
    
    Key points to include:
    1. Main topics covered
    2. Important concepts
    3. Key takeaways
    
    Keep the summary under 300 words.
    `;
    
    const promptTemplate = new PromptTemplate({
      template,
      inputVariables: ['courseContent'],
    });
    
    const chain = new LLMChain({ llm, prompt: promptTemplate });
    const result = await chain.call({
      courseContent,
    });
    
    return result.text;
  }
  
  // For longer content, split and summarize each chunk, then combine
  const chunks = await splitCourseContent(courseContent);
  const chunkSummaries: string[] = [];
  
  const template = `
  Summarize the following section of course material in 2-3 sentences:
  {chunkContent}
  `;
  
  const promptTemplate = new PromptTemplate({
    template,
    inputVariables: ['chunkContent'],
  });
  
  const chain = new LLMChain({ llm, prompt: promptTemplate });
  
  for (const chunk of chunks) {
    const result = await chain.call({
      chunkContent: chunk,
    });
    chunkSummaries.push(result.text);
  }
  
  // Combine chunk summaries into a final summary
  const combinedSummary = chunkSummaries.join('\n\n');
  
  const finalTemplate = `
  Based on these section summaries:
  {combinedSummary}
  
  Create a cohesive overall summary of the course material. Include:
  1. Main topics covered
  2. Important concepts
  3. Key takeaways
  
  Keep the summary under 300 words.
  `;
  
  const finalPromptTemplate = new PromptTemplate({
    template: finalTemplate,
    inputVariables: ['combinedSummary'],
  });
  
  const finalChain = new LLMChain({ llm, prompt: finalPromptTemplate });
  const finalResult = await finalChain.call({
    combinedSummary,
  });
  
  return finalResult.text;
}

/**
 * Extract key concepts from course content
 * @param courseContent The course content to analyze
 * @returns An array of key concepts
 */
export async function extractKeyConcepts(courseContent: string): Promise<string[]> {
  const llm = initializeLLM();
  
  const template = `
  Analyze the following course material and extract the 5-10 most important concepts or terms:
  {courseContent}
  
  Format your response as a JSON array of strings, with each string being a key concept.
  Example: ["Concept 1", "Concept 2", "Concept 3"]
  `;
  
  const promptTemplate = new PromptTemplate({
    template,
    inputVariables: ['courseContent'],
  });
  
  const chain = new LLMChain({ llm, prompt: promptTemplate });
  const result = await chain.call({
    courseContent: courseContent.length > 4000 ? courseContent.substring(0, 4000) : courseContent,
  });
  
  try {
    return JSON.parse(result.text);
  } catch (e) {
    // If parsing fails, try to extract the concepts from the text
    const matches: RegExpMatchArray | null = result.text.match(/["']([^"']+)["']/g);
    if (matches) {
      return matches.map(m => m.replace(/["']/g, ''));
    }
    return [];
  }
}

/**
 * Generate practice questions based on course content
 * @param courseContent The course content to use as context
 * @param numQuestions Number of questions to generate
 * @returns An array of question objects
 */
export async function generatePracticeQuestions(
  courseContent: string, 
  numQuestions: number = 5
): Promise<Array<{ question: string; answer: string }>> {
  const llm = initializeLLM();
  
  const template = `
  Based on the following course material:
  {courseContent}
  
  Generate ${numQuestions} practice questions with answers that test understanding of the material.
  
  Format your response as a JSON array of objects, each with "question" and "answer" fields.
  Example: [{"question": "What is X?", "answer": "X is Y"}]
  `;
  
  const promptTemplate = new PromptTemplate({
    template,
    inputVariables: ['courseContent'],
  });
  
  const chain = new LLMChain({ llm, prompt: promptTemplate });
  const result = await chain.call({
    courseContent: courseContent.length > 4000 ? courseContent.substring(0, 4000) : courseContent,
  });
  
  try {
    return JSON.parse(result.text);
  } catch (e) {
    console.error('Failed to parse practice questions:', e);
    return [];
  }
}

/**
 * Analyze multiple choice options and select the best answer
 * @param question The question text
 * @param options Array of possible answers
 * @param courseContent The course content to use as context
 * @returns The index of the best answer
 */
export async function selectBestMultipleChoiceAnswer(
  question: string,
  options: string[],
  courseContent: string
): Promise<number> {
  const llm = initializeLLM();
  
  const optionsText = options.map((opt, idx) => `${idx + 1}. ${opt}`).join('\n');
  
  const template = `
  Based on the following course material:
  {courseContent}
  
  Question: {question}
  
  Options:
  {optionsText}
  
  Analyze each option carefully and determine which one is the best answer based on the course material.
  Return ONLY the number of the correct option (1, 2, 3, etc.).
  `;
  
  const promptTemplate = new PromptTemplate({
    template,
    inputVariables: ['courseContent', 'question', 'optionsText'],
  });
  
  const chain = new LLMChain({ llm, prompt: promptTemplate });
  const result = await chain.call({
    courseContent: courseContent.length > 4000 ? courseContent.substring(0, 4000) : courseContent,
    question,
    optionsText,
  });
  
  // Extract the number from the response
  const match = result.text.match(/\d+/);
  if (match) {
    const selectedOption = parseInt(match[0], 10);
    // Convert from 1-based to 0-based index
    return selectedOption > 0 && selectedOption <= options.length ? selectedOption - 1 : 0;
  }
  
  return 0; // Default to first option if parsing fails
}

/**
 * Analyze exam questions and select the best answers
 * This function is specifically optimized for final exams in Target Solutions courses
 * @param questions Array of exam questions with their options
 * @param courseContent The course content to use as context
 * @returns Array of selected answer indices
 */
export async function answerExamQuestions(
  questions: Array<{ questionText: string; options: string[] }>,
  courseContent: string
): Promise<number[]> {
  const llm = initializeLLM();
  const answers: number[] = [];
  
  // Process each question individually for better accuracy
  for (let i = 0; i < questions.length; i++) {
    const question = questions[i];
    const optionsText = question.options.map((opt, idx) => `${idx + 1}. ${opt}`).join('\n');
    
    // Create a vector store from the course content for better retrieval
    const vectorStore = await createVectorStore(courseContent);
    const retriever = vectorStore.asRetriever();
    
    // Retrieve relevant context for this specific question
    const relevantDocs = await retriever.getRelevantDocuments(question.questionText);
    const relevantContext = relevantDocs.map(doc => doc.pageContent).join('\n\n');
    
    // Create a specialized prompt for exam questions
    const template = `
    You are an expert in answering exam questions for healthcare and safety courses.
    
    EXAM QUESTION: ${question.questionText}
    
    OPTIONS:
    ${optionsText}
    
    RELEVANT COURSE CONTENT:
    ${relevantContext}
    
    ADDITIONAL COURSE CONTENT:
    ${courseContent.length > 2000 ? courseContent.substring(0, 2000) + '...' : courseContent}
    
    INSTRUCTIONS:
    1. Carefully analyze the question and all options
    2. Consider the relevant course content to determine the correct answer
    3. For healthcare and safety courses, prioritize patient safety and standard protocols
    4. Return ONLY the number of the correct option (1, 2, 3, etc.)
    
    CORRECT ANSWER:
    `;
    
    // Use a more focused approach with higher temperature for exam questions
    const examLLM = new ChatOpenAI({
      openAIApiKey: config.openaiApiKey,
      modelName: config.modelName,
      temperature: 0.2, // Lower temperature for more focused answers
      maxTokens: 500,
    });
    
    const result = await examLLM.invoke(template);
    
    // Extract the number from the response
    const match = result.content.toString().match(/\d+/);
    if (match) {
      const selectedOption = parseInt(match[0], 10);
      // Convert from 1-based to 0-based index
      const answerIndex = selectedOption > 0 && selectedOption <= question.options.length ? selectedOption - 1 : 0;
      answers.push(answerIndex);
    } else {
      answers.push(0); // Default to first option if parsing fails
    }
  }
  
  return answers;
}