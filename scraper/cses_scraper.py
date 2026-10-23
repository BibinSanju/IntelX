import os
import json
import time
import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from content_normalizer import html_to_markdown

def get_cses_problems():
    url = "https://cses.fi/problemset/"
    response = requests.get(url)
    response.raise_for_status()
    soup = BeautifulSoup(response.text, 'html.parser')
    
    problems = []
    
    # Grab the first chapter (Introductory Problems) which is the second task-list
    task_lists = soup.find_all('ul', class_='task-list')
    if len(task_lists) < 2:
        print("Could not find problem task list")
        return []
        
    task_list = task_lists[1]
        
    for li in task_list.find_all('li', class_='task'):
        a_tag = li.find('a')
        if not a_tag:
            continue
        title = a_tag.text.strip()
        link = "https://cses.fi" + a_tag['href']
        
        print(f"Scraping: {title}...")
        prob_resp = requests.get(link)
        if prob_resp.status_code == 200:
            p_soup = BeautifulSoup(prob_resp.text, 'html.parser')
            # Extract the content of the problem
            # In CSES, the problem description is within a <div> with class "content" 
            # or in the <body> directly, but it usually uses a standard structure.
            content_div = p_soup.find('div', class_='skeleton')
            if content_div:
                # Get the content div specifically
                inner_content = content_div.find('div', class_='content')
                html_content = str(inner_content) if inner_content else str(content_div)
            else:
                html_content = "Content not found"
                
            problems.append({
                "title": title,
                "category": "CSES",
                "difficulty": "Easy",
                "tags": ["Introductory"],
                "source_url": link,
                "markdown_content": html_to_markdown(html_content),
                "html_content": html_content
            })
        time.sleep(0.5) 
        
    return problems

def main():
    print("Scraping CSES problems...")
    problems = get_cses_problems()
    
    print(f"Saving {len(problems)} problems to cses_problems.json")
    with open('cses_problems.json', 'w', encoding='utf-8') as f:
        json.dump(problems, f, indent=2, ensure_ascii=False)
        
    # Submit to the same backend pipeline used by every coding-problem scraper.
    env_path = os.path.join(os.path.dirname(__file__), '..', 'backend', '.env')
    load_dotenv(env_path)
    api_base = os.getenv('FEEDER_API_URL', 'http://localhost:3000')
    accepted = 0

    for q in problems:
        try:
            response = requests.post(f"{api_base}/api/ingest", json={
                "raw_text": f"Problem Title: {q['title']}\nDifficulty: {q['difficulty']}\n\n{q['markdown_content']}",
                "source": "CSES_Scraper",
                "tags": q['tags'],
                "hints": [],
                "source_url": q['source_url'],
                "source_metadata": {"provider": "cses", "category": q['category']},
            }, timeout=15)
            if response.status_code in (200, 201):
                accepted += 1
                print(f"Queued {q['title']}: {response.json().get('questionId')}")
            else:
                print(f"Failed {q['title']}: HTTP {response.status_code} {response.text}")
        except requests.RequestException as error:
            print(f"Failed {q['title']}: {error}")

    print(f"Done! Accepted {accepted}/{len(problems)} into the staged AI pipeline.")

if __name__ == "__main__":
    main()
