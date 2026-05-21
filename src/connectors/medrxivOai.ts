import type { ConnectorConfig, ConnectorMeta } from "../types";
import { BiorxivOaiConnector } from "./biorxivOai";

export const MEDRXIV_OAI_META: ConnectorMeta = {
  id: "medrxiv_oai",
  name: "medRxiv (OAI-PMH API)",
  baseUrl: "https://api.biorxiv.org",
  license: "varies (per preprint; often CC-BY-NC)",
  commercialUse: false,
  authType: "none",
  rateLimit: ">=2s interval",
  description:
    "medRxiv 预印本；ListRecords 经 api.biorxiv.org/details/medrxiv（JSON），非 www Cloudflare OAI",
};

export class MedrxivOaiConnector extends BiorxivOaiConnector {
  constructor(config: ConnectorConfig = {}) {
    super(
      {
        ...config,
        sourceOptions: { server: "medrxiv", ...(config.sourceOptions ?? {}) },
      },
      MEDRXIV_OAI_META,
    );
  }
}
