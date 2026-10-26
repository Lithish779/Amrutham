module.exports = async () => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgres://amrutam:amrutam@localhost:5432/amrutam_test';
  const { migrate } = require('../scripts/migrate');
  await migrate(process.env.DATABASE_URL);
};
