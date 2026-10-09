import urllib.request,urllib.error
try:
 with urllib.request.urlopen('http://localhost:5000/api/v1/users/me/',timeout=3) as response:print('Backend reachable; unauthenticated profile HTTP',response.status)
except urllib.error.HTTPError as error: print('Backend reachable; unauthenticated profile HTTP',error.code)
except (urllib.error.URLError,TimeoutError,OSError):print('Backend unavailable at localhost:5000; validation will use intercepted contract responses, not live credentials.')
