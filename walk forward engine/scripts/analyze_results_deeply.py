
import json
import pandas as pd
from datetime import datetime
import tabulate

def analyze_json(filepath):
    with open(filepath, 'r') as f:
        data = json.load(f)
    
    windows = data['window_results']
    rows = []
    
    for w in windows:
        test_start = datetime.fromisoformat(w['testing_period_start'])
        rows.append({
            'year': test_start.year,
            'trades': w['total_trades'],
            'profit': w['gross_profit'] - w['gross_loss'],
            'gross_profit': w['gross_profit'],
            'gross_loss': w['gross_loss'],
            'return': w['total_return_pct'],
            'wins': w['win_count'],
            'losses': w['loss_count']
        })
        
    df = pd.DataFrame(rows)
    
    # Group by year
    yearly = df.groupby('year').agg({
        'trades': 'sum',
        'profit': 'sum',
        'gross_profit': 'sum',
        'gross_loss': 'sum',
        'return': 'sum', # Approximate
        'wins': 'sum',
        'losses': 'sum'
    }).reset_index()
    
    yearly['win_rate'] = (yearly['wins'] / yearly['trades'] * 100).fillna(0)
    yearly['pf'] = (yearly['gross_profit'] / yearly['gross_loss']).fillna(0)
    
    print("\nYEARLY PERFORMANCE BREAKDOWN:")
    print(yearly[['year', 'trades', 'win_rate', 'pf', 'return', 'profit']].to_string(index=False, float_format="%.2f"))
    
    # Analyze Zero Trade periods
    zero_trades = df[df['trades'] == 0]
    print(f"\nWindows with ZERO trades: {len(zero_trades)} out of {len(df)}")
    if len(zero_trades) > 0:
        print("Years with zero trades:", sorted(zero_trades['year'].unique()))

if __name__ == "__main__":
    import sys
    filepath = sys.argv[1] if len(sys.argv) > 1 else "results/london_breakout_orb_full_2003_2025/walk_forward_results_20260107_105845.json"
    analyze_json(filepath)
