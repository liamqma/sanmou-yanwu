const { test, expect } = require('playwright/test');

test.describe('Prompt Generator', () => {
  test('generateLLMPrompt should not contain [object Promise]', async ({ page }) => {
    // Navigate and wait for data to load
    await page.goto('/');
    await page.waitForSelector('.item-picker', { timeout: 10000 });

    // Generate prompt via page context using the service
    const prompt = await page.evaluate(async () => {
      // Fetch data the same way the app does
      const [db, db2, battleStats] = await Promise.all([
        fetch('/data/database.json').then(r => r.json()),
        fetch('/data/database2.json').then(r => r.json()),
        fetch('/data/battle_stats.json').then(r => r.json()),
      ]);

      // Import the module dynamically
      const { generateLLMPrompt, generateTeamBuilderPrompt } = await import('/src/services/promptGenerator.js');

      // Test generateLLMPrompt with mock game state
      const gameState = {
        round_number: 1,
        current_heroes: ['关羽', '张飞', '刘备', '赵云'],
        current_skills: ['一计决胜', '七进七出', '万人之敌'],
      };
      const currentRoundInputs = {
        set1: ['马超', '黄忠', '魏延'],
        set2: ['吕布', '貂蝉', '张辽'],
        set3: ['曹操', '司马懿', '郭嘉'],
      };

      const llmPrompt = await generateLLMPrompt({
        gameState,
        currentRoundInputs,
        recommendation: null,
        roundType: 'hero',
      });

      const teamPrompt = await generateTeamBuilderPrompt(
        gameState.current_heroes,
        gameState.current_skills,
      );

      return { llmPrompt, teamPrompt };
    });

    // Verify no [object Promise] in either prompt
    expect(prompt.llmPrompt).not.toContain('[object Promise]');
    expect(prompt.teamPrompt).not.toContain('[object Promise]');

    // Verify prompts contain expected content
    expect(prompt.llmPrompt).toContain('三国谋定天下');
    expect(prompt.teamPrompt).toContain('三国谋定天下');

    // Verify prompts are non-trivial
    expect(prompt.llmPrompt.length).toBeGreaterThan(100);
    expect(prompt.teamPrompt.length).toBeGreaterThan(100);
  });
});
