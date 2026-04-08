import requests
import time

QA_SERVER = "http://localhost:3000/signal"

FAKE_REDDIT_POSTS = [
    {
        "site_url": "https://bharatmcp.com",
        "issue":    "schedule meeting button not working, form crashes on submit",
        "page":     "/talk-with-us",
        "source":   "reddit",
        "severity": "high",
    },
    {
        "site_url": "https://bharatmcp.com",
        "issue":    "early access page not loading",
        "page":     "/early-access",
        "source":   "reddit",
        "severity": "medium",
    },
    {
        "site_url": "https://bharatmcp.com",
        "issue":    "homepage is very slow",
        "page":     "/",
        "source":   "reddit",
        "severity": "low",
    },
]

def main():
    print(f"Sending {len(FAKE_REDDIT_POSTS)} fake Reddit signals to QA server...")
    print(f"QA Server: {QA_SERVER}\n")

    for i, post in enumerate(FAKE_REDDIT_POSTS, 1):
        print(f"[{i}/{len(FAKE_REDDIT_POSTS)}] Sending: {post['issue'][:60]}")
        try:
            resp = requests.post(QA_SERVER, json=post, timeout=10)
            data = resp.json()
            print(f"  → status: {data.get('status')}")
            print(f"  → target: {data.get('target_url')}")
            print(f"  → kb_used: {data.get('kb_used')}")
            print()
        except Exception as e:
            print(f"  → ERROR: {e}\n")

        time.sleep(2)

    print("Done! Check NestJS terminal for agent results.")

if __name__ == "__main__":
    main()
