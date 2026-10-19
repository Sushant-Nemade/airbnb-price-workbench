import argparse
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description="Historical NYC Airbnb price workbench")
    subcommands = parser.add_subparsers(dest="command", required=True)
    fetching = subcommands.add_parser("fetch-data")
    fetching.add_argument("--output", type=Path, default=Path("data/raw/AB_NYC_2019.csv"))
    training = subcommands.add_parser("train")
    training.add_argument("--csv", type=Path, default=Path("data/raw/AB_NYC_2019.csv"))
    training.add_argument("--output", type=Path, default=Path("src/airbnb_price/artifacts"))
    subcommands.add_parser("serve")
    options = parser.parse_args()
    if options.command == "fetch-data":
        from airbnb_price.fetch import fetch_dataset

        fetch_dataset(options.output)
    elif options.command == "train":
        from airbnb_price.train import train

        train(options.csv, options.output)
    else:
        import uvicorn

        uvicorn.run("airbnb_price.web:app", host="127.0.0.1", port=8896)


if __name__ == "__main__":
    main()
