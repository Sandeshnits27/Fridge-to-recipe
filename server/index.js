import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3001);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

app.use(cors());
app.use(express.json({ limit: '1mb' }));

function normalizeRecipe(rawRecipe) {
  if (!rawRecipe || typeof rawRecipe !== 'object') {
    throw new Error('The AI returned no recipe object.');
  }

  const title = typeof rawRecipe.title === 'string' && rawRecipe.title.trim()
    ? rawRecipe.title.trim()
    : 'Quick Fridge Meal';

  const description = typeof rawRecipe.description === 'string' && rawRecipe.description.trim()
    ? rawRecipe.description.trim()
    : 'A simple meal made from the ingredients you listed.';

  const baseServings = Number(rawRecipe.baseServings) || 2;

  const ingredients = Array.isArray(rawRecipe.ingredients) ? rawRecipe.ingredients.map((item, index) => {
    const name = typeof item?.name === 'string' && item.name.trim() ? item.name.trim() : `Ingredient ${index + 1}`;
    const unit = typeof item?.unit === 'string' ? item.unit.trim() : '';
    const amount = Number(item?.amount ?? 0);
    return { name, unit, amount: Number.isFinite(amount) ? amount : 0 };
  }).filter((item) => item.name) : [];

  const steps = Array.isArray(rawRecipe.steps)
    ? rawRecipe.steps.map((step) => String(step).trim()).filter(Boolean)
    : [];

  const swaps = Array.isArray(rawRecipe.swaps)
    ? rawRecipe.swaps
        .map((swap) => {
          if (!swap || typeof swap !== 'object') return null;
          const ingredient = typeof swap.ingredient === 'string' ? swap.ingredient.trim() : '';
          const replacement = typeof swap.replacement === 'string' ? swap.replacement.trim() : '';
          if (!ingredient || !replacement) return null;
          return { ingredient, replacement };
        })
        .filter(Boolean)
    : [];

  const notes = Array.isArray(rawRecipe.notes)
    ? rawRecipe.notes.map((note) => String(note).trim()).filter(Boolean)
    : [];

  if (ingredients.length === 0 || steps.length === 0) {
    throw new Error('The model returned an incomplete recipe.');
  }

  return { title, description, baseServings, ingredients, steps, swaps, notes };
}

function buildFallbackRecipe(ingredients) {
  const cleanIngredients = ingredients.filter(Boolean);
  const primaryIngredient = cleanIngredients[0] || 'vegetables';
  const title = `${primaryIngredient.charAt(0).toUpperCase()}${primaryIngredient.slice(1)} Skillet`;

  const ingredientList = cleanIngredients.map((ingredient, index) => ({
    amount: index === 0 ? 2 : 1,
    unit: index === 0 ? 'cups' : 'tbsp',
    name: ingredient,
  }));

  return normalizeRecipe({
    title,
    description: `A practical, pantry-friendly meal built from the ingredients you listed: ${cleanIngredients.join(', ')}.`,
    baseServings: 2,
    ingredients: ingredientList,
    steps: [
      `Prep the ingredients by washing and chopping the ${cleanIngredients.slice(0, 2).join(' and ')}.`,
      'Heat a pan over medium heat and add a little oil.',
      'Cook the ingredients together until they are tender and fragrant.',
      'Season with salt, pepper, and any herbs or spices you have available.',
      'Serve warm as a quick, satisfying meal.',
    ],
    swaps: [
      { ingredient: cleanIngredients[0] || 'vegetable', replacement: 'rice or noodles' },
      { ingredient: 'oil', replacement: 'butter or broth' },
    ],
    notes: [],
  });
}

app.post('/api/recipe', async (req, res) => {
  try {
    const ingredientsInput = Array.isArray(req.body?.ingredients) ? req.body.ingredients : [];
    const ingredients = ingredientsInput.map((item) => String(item).trim()).filter(Boolean);

    if (ingredients.length === 0) {
      return res.status(400).json({ error: 'Please enter at least one ingredient.' });
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return res.json({ recipe: buildFallbackRecipe(ingredients) });
    }

    const prompt = `You are generating a simple recipe from fridge ingredients. Return valid JSON only with this exact shape:\n{\n  "title": "string",\n  "description": "string",\n  "baseServings": 2,\n  "ingredients": [{ "amount": 1, "unit": "cup", "name": "rice" }],\n  "steps": ["string"],\n  "swaps": [{ "ingredient": "string", "replacement": "string" }],\n  "notes": ["string"]\n}\nUse the ingredients: ${ingredients.join(', ')}. Keep the recipe realistic, easy, and practical for a home kitchen. Make sure the JSON is valid and complete.`;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:5173',
        'X-Title': 'Fridge to Recipe',
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You return only valid JSON with a recipe object. Do not wrap the JSON in markdown fences.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || 'The model request failed.');
    }

    const result = await response.json();
    const content = result?.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error('The model returned no content.');
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      const match = content.match(/\{[\s\S]*\}/);
      if (!match) {
        throw new Error('The model returned malformed JSON.');
      }
      parsed = JSON.parse(match[0]);
    }

    const recipe = normalizeRecipe(parsed);
    res.json({ recipe });
  } catch (error) {
    res.status(502).json({ error: error.message || 'The recipe could not be generated.' });
  }
});

app.use(express.static(projectRoot));
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    return next();
  }

  res.sendFile(path.join(projectRoot, 'index.html'));
});

app.listen(port, () => {
  console.log(`Fridge-to-recipe server listening on http://localhost:${port}`);
});
