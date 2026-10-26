module.exports = async () => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgres://amrutam:amrutam@localhost:5432/amrutam_test';
  const { migrate } = require('../scripts/migrate');
  try {
    await migrate(process.env.DATABASE_URL);
  } catch (err) {
    if (process.env.REQUIRE_DB_SETUP === 'true') {
      throw err;
    }
    console.warn(`[WARN] DB migration skipped during globalSetup (Postgres offline): ${err.message}`);
  }
};

