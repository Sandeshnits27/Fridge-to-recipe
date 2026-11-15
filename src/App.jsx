import { useMemo, useRef, useState } from 'react';

const formatAmount = (amount) => {
  if (!Number.isFinite(amount)) return '0';
  const rounded = Math.round(amount * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
};

const normalizeIngredients = (ingredients, servings, baseServings) => {
  const ratio = baseServings > 0 ? servings / baseServings : 1;

  return ingredients.map((ingredient) => {
    const amount = Number(ingredient.amount) || 0;
    const scaledAmount = amount * ratio;
    const cleanUnit = ingredient.unit ? `${ingredient.unit} ` : '';

    return {
      ...ingredient,
      scaledAmount,
      display: `${formatAmount(scaledAmount)} ${cleanUnit}${ingredient.name}`.trim(),
    };
  });
};

function App() {
  const [ingredientsInput, setIngredientsInput] = useState('');
  const [recipe, setRecipe] = useState(null);
  const [servings, setServings] = useState(2);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [stepChecks, setStepChecks] = useState({});
  const requestIdRef = useRef(0);

  const visibleIngredients = useMemo(() => {
    if (!recipe) return [];
    return normalizeIngredients(recipe.ingredients, servings, recipe.baseServings || 2);
  }, [recipe, servings]);

  const handleGenerate = async () => {
    const cleanIngredients = ingredientsInput
      .split(/\n|,/)
      .map((item) => item.trim())
      .filter(Boolean);

    if (cleanIngredients.length === 0) {
      setError('Please enter at least one ingredient.');
      setStatus('error');
      return;
    }

    const currentRequestId = ++requestIdRef.current;
    setStatus('loading');
    setError('');
    setRecipe(null);
    setStepChecks({});

    try {
      const response = await fetch('/api/recipe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingredients: cleanIngredients }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error || 'The request failed.');
      }

      if (currentRequestId !== requestIdRef.current) {
        return;
      }

      setRecipe(payload.recipe);
      setServings(payload.recipe.baseServings || 2);
      setStatus('success');
    } catch (requestError) {
      if (currentRequestId !== requestIdRef.current) {
        return;
      }
      setStatus('error');
      setError(requestError.message || 'Something went wrong while generating a recipe.');
    }
  };

  const handleServingsChange = (amount) => {
    setServings((current) => Math.max(1, current + amount));
  };

  const toggleStep = (index) => {
    setStepChecks((current) => ({
      ...current,
      [index]: !current[index],
    }));
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <p className="eyebrow">Fridge-to-recipe</p>
        <h1>Turn ingredients into a meal.</h1>
      </header>

      <main className="content-grid">
        <section className="panel input-panel">
          <label htmlFor="ingredients">What is in the fridge?</label>
          <textarea
            id="ingredients"
            value={ingredientsInput}
            onChange={(event) => setIngredientsInput(event.target.value)}
            placeholder="Rice, chicken, spinach, onion, garlic, coconut milk, lime"
            rows={10}
          />

          <button type="button" className="primary-button" onClick={handleGenerate} disabled={status === 'loading'}>
            {status === 'loading' ? 'Cooking...' : 'Generate recipe'}
          </button>

          {status === 'error' && <p className="message error">{error}</p>}
          {status === 'loading' && <p className="message loading">Cooking up a recipe...</p>}
          {status === 'idle' && <p className="message empty">Add ingredients to generate a recipe.</p>}
        </section>

        <section className="panel output-panel">
          {!recipe && status !== 'loading' && (
            <div className="empty-state">
              <h2>No recipe yet</h2>
              <p>Use the ingredient list to create a quick, practical meal.</p>
            </div>
          )}

          {recipe && (
            <>
              <div className="recipe-header">
                <div>
                  <p className="label">Recipe</p>
                  <h2>{recipe.title}</h2>
                </div>

                <div className="servings-control" aria-label="Adjust servings">
                  <button type="button" onClick={() => handleServingsChange(-1)} aria-label="Reduce servings">-</button>
                  <span>{servings} servings</span>
                  <button type="button" onClick={() => handleServingsChange(1)} aria-label="Increase servings">+</button>
                </div>
              </div>

              <p className="description">{recipe.description}</p>

              <div className="meta-row">
                <div>
                  <span className="meta-label">Base</span>
                  <strong>{recipe.baseServings} servings</strong>
                </div>
                <div>
                  <span className="meta-label">Now</span>
                  <strong>{servings} servings</strong>
                </div>
              </div>

              <div className="section-block">
                <h3>Ingredients</h3>
                <ul className="ingredient-list">
                  {visibleIngredients.map((ingredient) => (
                    <li key={`${ingredient.name}-${ingredient.unit}`}>
                      <span>{ingredient.display}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="section-block">
                <h3>Steps</h3>
                <ol className="step-list">
                  {recipe.steps.map((step, index) => (
                    <li key={`${step}-${index}`} className={stepChecks[index] ? 'done' : ''}>
                      <label>
                        <input
                          type="checkbox"
                          checked={Boolean(stepChecks[index])}
                          onChange={() => toggleStep(index)}
                        />
                        <span>{step}</span>
                      </label>
                    </li>
                  ))}
                </ol>
              </div>

              {recipe.swaps && recipe.swaps.length > 0 && (
                <div className="section-block">
                  <h3>Ingredient swaps</h3>
                  <ul className="swap-list">
                    {recipe.swaps.map((swap, index) => (
                      <li key={`${swap.ingredient}-${index}`}>
                        <strong>{swap.ingredient}</strong> → {swap.replacement}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {recipe.notes && recipe.notes.length > 0 && (
                <div className="section-block">
                  <h3>Notes</h3>
                  <ul className="note-list">
                    {recipe.notes.map((note, index) => (
                      <li key={`${note}-${index}`}>{note}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
