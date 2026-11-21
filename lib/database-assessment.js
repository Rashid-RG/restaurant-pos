/**
 * Consolidated, metadata-only database migration readiness report.
 * No I/O, database connections, queries, application data, or write actions.
 * Its findings are advisory; "no findings" is NOT approval to deploy.
 */
import { compareDatabaseSchemas } from './schema-diff.js';
import { reviewIndexCoverage } from './index-coverage-review.js';
import { reviewTenantForeignKeys } from './tenant-foreign-key-review.js';

export function assessDatabaseMigration(before, proposed) {
  const schema = compareDatabaseSchemas(before, proposed);
  const indexes = reviewIndexCoverage(proposed);
  const relationships = reviewTenantForeignKeys(proposed);
  const candidateIndexes = indexes.findings
    .filter(finding => finding.status === 'review_candidate');
  const tenantLinks = relationships.findings
    .filter(finding => finding.status === 'tenant_pair_missing_manual_review');
  const globalUniqueCandidates = proposed.tables.flatMap(table =>
    (table.review?.globalUniqueIndexCandidates || []).map(index => ({table: table.name, index})));
  return {
    format: 'gastroflow-database-assessment',
    version: 1,
    verdict: schema.highRiskCount > 0 ? 'high_risk_manual_review' : 'manual_approval_required',
    changes: schema.changes,
    metrics: {
      tableCountBefore: before.tables.length,
      tableCountProposed: proposed.tables.length,
      schemaChangeCount: schema.changes.length,
      highRiskSchemaChanges: schema.highRiskCount,
      missingIndexCoverageCandidates: candidateIndexes.length,
      possibleOverlappingIndexPairs: indexes.duplicatePrefixes.length,
      tenantForeignKeyReviewCandidates: tenantLinks.length,
      globalUniqueIndexCandidates: globalUniqueCandidates.length,
    },
    review: {
      indexCoverageCandidates: candidateIndexes,
      overlappingIndexPairs: indexes.duplicatePrefixes,
      tenantForeignKeys: tenantLinks,
      globalUniqueIndexes: globalUniqueCandidates,
    },
    releaseGates: {
      encryptedBackupVerified: false,
      actualDataRestoredAndReconciled: false,
      applicationTenantTestsPassed: false,
      migrationRollbackRehearsed: false,
      explicitStagingApproval: false,
    },
    note: 'Offline schema advisory only. Never deploy, migrate, or modify Turso based solely on this report.',
  };
}
