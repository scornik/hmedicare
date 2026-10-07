import { type DynamicModule, Global, Module } from '@nestjs/common';
import type { DocumentDownloadService } from '../infrastructure/document-download';

// NestJS modules of the laboratory-documents context.
export const DOCUMENT_SERVICES = Symbol('DOCUMENT_SERVICES');

export interface DocumentServices {
  /** Describing, token-issuing and streaming for stored documents. */
  downloads: DocumentDownloadService;
}

@Global()
@Module({})
export class DocumentModule {
  static forRoot(services: DocumentServices): DynamicModule {
    return {
      module: DocumentModule,
      providers: [{ provide: DOCUMENT_SERVICES, useValue: services }],
      exports: [DOCUMENT_SERVICES],
    };
  }
}
