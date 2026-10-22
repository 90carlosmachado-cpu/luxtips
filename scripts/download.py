"""Fetch the reproducible backtest dataset. Credential only from the environment."""
import os,json,pathlib,urllib.request,time
key=os.environ['API_FOOTBALL_KEY']
root=pathlib.Path('data');root.mkdir(exist_ok=True)
for league in [94,39,140,78,135,61]:
    for suffix,name in [(f'leagues?id={league}',f'coverage-{league}')]+[(f'fixtures?league={league}&season={year}',f'fixtures-{league}-{year}') for year in [2023,2024,2025,2026]]:
        req=urllib.request.Request('https://v3.football.api-sports.io/'+suffix,headers={'x-apisports-key':key})
        with urllib.request.urlopen(req,timeout=45) as r: data=json.load(r)
        if data.get('errors') or data.get('paging',{}).get('total',1)>1: raise RuntimeError('API error or incomplete pagination; dataset not accepted')
        (root/(name+'.json')).write_text(json.dumps(data))
        print(name,data.get('results',0),flush=True)
        time.sleep(.25)
