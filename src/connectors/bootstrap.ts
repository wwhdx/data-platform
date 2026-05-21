import type { Scheduler } from "../scheduler";
import { resolveConnectorConfig } from "./factory";
import { OpenAlexConnector } from "./openalex";
import { CrossRefConnector } from "./crossref";
import { WorldBankConnector } from "./worldbank";
import { PubMedConnector, PUBMED_META } from "./pubmed";
import {
  SemanticScholarConnector,
  SEMANTIC_SCHOLAR_META,
} from "./semanticscholar";
import { ArxivOaiConnector, ARXIV_OAI_META } from "./arxivOai";
import { BiorxivOaiConnector, BIORXIV_OAI_META } from "./biorxivOai";
import { MedrxivOaiConnector, MEDRXIV_OAI_META } from "./medrxivOai";
import { PatentsViewConnector, PATENTSVIEW_META } from "./patentsview";
import {
  ClinicalTrialsConnector,
  CLINICALTRIALS_META,
} from "./clinicaltrials";
import { SecEdgarConnector, SEC_EDGAR_META } from "./secEdgar";
import { GitHubConnector, GITHUB_META } from "./github";
import { HackerNewsConnector, HACKERNEWS_META } from "./hackernews";
import { FredConnector, FRED_META } from "./fred";
import { EpoOpsConnector, EPO_OPS_META } from "./epoOps";
import {
  GooglePatentsConnector,
  GOOGLE_PATENTS_META,
} from "./googlePatents";
import {
  YahooFinanceConnector,
  YAHOO_FINANCE_META,
} from "./yahooFinance";
import { RedditConnector, REDDIT_META } from "./reddit";
import { YouTubeConnector, YOUTUBE_META } from "./youtube";
import { OPENALEX_META } from "./openalex";
import { CROSSREF_META } from "./crossref";
import { WORLD_BANK_META } from "./worldbank";

export {
  OPENALEX_META,
  CROSSREF_META,
  WORLD_BANK_META,
  PUBMED_META,
  SEMANTIC_SCHOLAR_META,
  ARXIV_OAI_META,
  BIORXIV_OAI_META,
  MEDRXIV_OAI_META,
  PATENTSVIEW_META,
  CLINICALTRIALS_META,
  SEC_EDGAR_META,
  GITHUB_META,
  HACKERNEWS_META,
  FRED_META,
  EPO_OPS_META,
  GOOGLE_PATENTS_META,
  YAHOO_FINANCE_META,
  REDDIT_META,
  YOUTUBE_META,
};

/** 运行时已 registerConnector 的源 id（与 scheduleReport / B14 对齐） */
export const REGISTERED_CONNECTOR_IDS = [
  "openalex",
  "crossref",
  "worldbank",
  "pubmed",
  "semanticscholar",
  "arxiv_oai",
  "biorxiv_oai",
  "medrxiv_oai",
  "patentsview",
  "clinicaltrials",
  "sec_edgar",
  "github",
  "hackernews",
  "fred",
  "epo_ops",
  "google_patents",
  "yahoo_finance",
  "reddit",
  "youtube",
] as const;

export async function registerDefaultConnectors(
  scheduler: Scheduler,
): Promise<void> {
  const openalex = new OpenAlexConnector(
    await resolveConnectorConfig("openalex", OPENALEX_META, {
      apiKey: process.env.OPENALEX_API_KEY,
    }),
  );
  const crossref = new CrossRefConnector(
    await resolveConnectorConfig("crossref", CROSSREF_META, {
      apiKey: process.env.CROSSREF_MAILTO,
    }),
  );
  const worldbank = new WorldBankConnector(
    await resolveConnectorConfig("worldbank", WORLD_BANK_META),
  );
  const pubmed = new PubMedConnector(
    await resolveConnectorConfig("pubmed", PUBMED_META, {
      apiKey: process.env.NCBI_API_KEY,
    }),
  );
  const semanticscholar = new SemanticScholarConnector(
    await resolveConnectorConfig("semanticscholar", SEMANTIC_SCHOLAR_META, {
      apiKey: process.env.SEMANTIC_SCHOLAR_API_KEY,
    }),
  );
  const arxivOai = new ArxivOaiConnector(
    await resolveConnectorConfig("arxiv_oai", ARXIV_OAI_META),
  );
  const biorxivOai = new BiorxivOaiConnector(
    await resolveConnectorConfig("biorxiv_oai", BIORXIV_OAI_META),
  );
  const medrxivOai = new MedrxivOaiConnector(
    await resolveConnectorConfig("medrxiv_oai", MEDRXIV_OAI_META),
  );
  const patentsview = new PatentsViewConnector(
    await resolveConnectorConfig("patentsview", PATENTSVIEW_META, {
      apiKey: process.env.USPTO_ODP_API_KEY,
    }),
  );
  const clinicaltrials = new ClinicalTrialsConnector(
    await resolveConnectorConfig("clinicaltrials", CLINICALTRIALS_META),
  );
  const secEdgar = new SecEdgarConnector(
    await resolveConnectorConfig("sec_edgar", SEC_EDGAR_META, {
      userAgent: process.env.SEC_EDGAR_USER_AGENT,
    }),
  );
  const github = new GitHubConnector(
    await resolveConnectorConfig("github", GITHUB_META, {
      apiKey: process.env.GITHUB_TOKEN,
    }),
  );
  const hackernews = new HackerNewsConnector(
    await resolveConnectorConfig("hackernews", HACKERNEWS_META),
  );
  const fred = new FredConnector(
    await resolveConnectorConfig("fred", FRED_META, {
      apiKey: process.env.FRED_API_KEY,
    }),
  );
  const epoOps = new EpoOpsConnector(
    await resolveConnectorConfig("epo_ops", EPO_OPS_META, {
      apiKey: process.env.EPO_OPS_CONSUMER_KEY,
      apiSecret: process.env.EPO_OPS_CONSUMER_SECRET,
    }),
  );
  const googlePatents = new GooglePatentsConnector(
    await resolveConnectorConfig("google_patents", GOOGLE_PATENTS_META),
  );
  const yahooFinance = new YahooFinanceConnector(
    await resolveConnectorConfig("yahoo_finance", YAHOO_FINANCE_META),
  );
  const reddit = new RedditConnector(
    await resolveConnectorConfig("reddit", REDDIT_META, {
      apiKey: process.env.REDDIT_CLIENT_ID,
      apiSecret: process.env.REDDIT_CLIENT_SECRET,
      userAgent: process.env.REDDIT_USER_AGENT,
    }),
  );
  const youtube = new YouTubeConnector(
    await resolveConnectorConfig("youtube", YOUTUBE_META, {
      apiKey: process.env.YOUTUBE_API_KEY,
    }),
  );

  scheduler.registerConnector({ id: "openalex", create: () => openalex });
  scheduler.registerConnector({ id: "crossref", create: () => crossref });
  scheduler.registerConnector({ id: "worldbank", create: () => worldbank });
  scheduler.registerConnector({ id: "pubmed", create: () => pubmed });
  scheduler.registerConnector({
    id: "semanticscholar",
    create: () => semanticscholar,
  });
  scheduler.registerConnector({ id: "arxiv_oai", create: () => arxivOai });
  scheduler.registerConnector({ id: "biorxiv_oai", create: () => biorxivOai });
  scheduler.registerConnector({ id: "medrxiv_oai", create: () => medrxivOai });
  scheduler.registerConnector({ id: "patentsview", create: () => patentsview });
  scheduler.registerConnector({
    id: "clinicaltrials",
    create: () => clinicaltrials,
  });
  scheduler.registerConnector({ id: "sec_edgar", create: () => secEdgar });
  scheduler.registerConnector({ id: "github", create: () => github });
  scheduler.registerConnector({ id: "hackernews", create: () => hackernews });
  scheduler.registerConnector({ id: "fred", create: () => fred });
  scheduler.registerConnector({ id: "epo_ops", create: () => epoOps });
  scheduler.registerConnector({
    id: "google_patents",
    create: () => googlePatents,
  });
  scheduler.registerConnector({
    id: "yahoo_finance",
    create: () => yahooFinance,
  });
  scheduler.registerConnector({ id: "reddit", create: () => reddit });
  scheduler.registerConnector({ id: "youtube", create: () => youtube });
}
