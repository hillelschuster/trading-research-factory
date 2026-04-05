#!/usr/bin/env python3
"""Fetch current Polymarket data via Gamma API."""
import json
import urllib.request
import urllib.parse
import datetime

def get_demo_data():
    """Generate demo Polymarket data for concept testing when API unavailable."""
    demo_markets = [
        {"id": "demo_1", "question": "Will BTC exceed $100k in 2026?", "slug": "btc-100k-2026",
         "volume": 5000000, "liquidity": 1000000, "yes_price": 0.45, "no_price": 0.55, "end_date": "2027-01-01"},
        {"id": "demo_2", "question": "Will ETH reach $5k in 2026?", "slug": "eth-5k-2026",
         "volume": 3000000, "liquidity": 800000, "yes_price": 0.52, "no_price": 0.48, "end_date": "2027-01-01"},
        {"id": "demo_3", "question": "Will SOL outperform BTC in 2026?", "slug": "sol-outperform-btc-2026",
         "volume": 1500000, "liquidity": 500000, "yes_price": 0.58, "no_price": 0.42, "end_date": "2027-01-01"},
        {"id": "demo_4", "question": "Will there be a crypto regulation bill in US in 2026?", "slug": "crypto-regulation-2026",
         "volume": 2000000, "liquidity": 600000, "yes_price": 0.72, "no_price": 0.28, "end_date": "2027-01-01"},
        {"id": "demo_5", "question": "Will DeFi TVL exceed $200B in 2026?", "slug": "defi-tvl-200b-2026",
         "volume": 800000, "liquidity": 300000, "yes_price": 0.48, "no_price": 0.52, "end_date": "2027-01-01"}
    ]
    return demo_markets

def fetch_polymarkets():
    """Fetch current Polymarket markets via Gamma API."""
    urls = [
        "https://gamma-api.polymarket.com/markets",
        "https://clob.polymarket.com/markets",
        "https://polymarket.com/api/markets",
    ]
    
    for url in urls:
        print(f"Trying: {url}")
        try:
            req = urllib.request.Request(url)
            req.add_header('User-Agent', 'Mozilla/5.0')
            req.add_header('Accept', 'application/json')
            with urllib.request.urlopen(req, timeout=15) as response:
                data = json.loads(response.read().decode())
                print(f"Success! Fetched {len(data) if isinstance(data, list) else 'some'} markets")
                return data if isinstance(data, list) else [data]
        except Exception as e:
            print(f"  Failed: {e}")
            continue
    
    print("\nAPI unavailable - generating demo sentiment data for concept testing")
    return get_demo_data()

def filter_crypto_markets(markets):
    """Filter for crypto-related markets."""
    crypto_keywords = ["btc", "bitcoin", "eth", "ethereum", "crypto", "sol", "solana", "blockchain"]
    crypto_markets = []
    
    for m in markets:
        title = m.get("question", "").lower()
        slug = m.get("slug", "").lower()
        description = m.get("description", "").lower()
        
        if any(kw in title or kw in slug or kw in description for kw in crypto_keywords):
            outcome_prices = m.get("outcomePrices", [])
            if outcome_prices and len(outcome_prices) >= 2:
                try:
                    yes_price = float(outcome_prices[0]) if outcome_prices[0] else 0.5
                    no_price = float(outcome_prices[1]) if outcome_prices[1] else 0.5
                except:
                    yes_price, no_price = 0.5, 0.5
            else:
                yes_price, no_price = m.get("yes_price", 0.5), m.get("no_price", 0.5)
            
            crypto_markets.append({
                "id": m.get("id"),
                "question": m.get("question"),
                "slug": m.get("slug"),
                "volume": m.get("volume", 0),
                "liquidity": m.get("liquidity", 0),
                "yes_price": yes_price,
                "no_price": no_price,
                "end_date": m.get("endDate"),
                "sentiment": "bullish" if yes_price > 0.6 else ("bearish" if no_price > 0.6 else "neutral")
            })
    
    return crypto_markets

def calculate_sentiment(markets):
    """Calculate aggregated sentiment from markets."""
    if not markets:
        return {"yes_avg": 0.5, "sentiment": "neutral", "count": 0}
    
    yes_avg = sum(m["yes_price"] for m in markets) / len(markets)
    no_avg = sum(m["no_price"] for m in markets) / len(markets)
    
    sentiment = "neutral"
    if yes_avg > 0.6:
        sentiment = "bullish"
    elif no_avg > 0.6:
        sentiment = "bearish"
    
    return {"yes_avg": yes_avg, "no_avg": no_avg, "sentiment": sentiment, "count": len(markets)}

if __name__ == "__main__":
    print("Fetching Polymarket data...")
    markets = fetch_polymarkets()
    
    if markets:
        crypto_markets = filter_crypto_markets(markets)
        sentiment = calculate_sentiment(crypto_markets)
        
        result = {
            "timestamp": "2026-03-17T22:30:00Z",
            "total_markets": len(markets),
            "crypto_markets": crypto_markets,
            "sentiment": sentiment
        }
        
        with open("workspace/data/polymarket_current.json", "w") as f:
            json.dump(result, f, indent=2)
        
        print(f"\nFound {len(crypto_markets)} crypto-related markets")
        print(f"Aggregated sentiment: {sentiment}")
        print(f"Saved to workspace/data/polymarket_current.json")
    else:
        print("Failed to fetch Polymarket data")
