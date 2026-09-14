import argparse
import json
import time
from datetime import datetime
from pathlib import Path

from appium import webdriver
from appium.options.android import UiAutomator2Options
from selenium.common.exceptions import WebDriverException


def load_config(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def timestamp() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S")


def save_artifacts(driver, output_dir: Path, prefix: str) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    xml_path = output_dir / f"{prefix}_page.xml"
    png_path = output_dir / f"{prefix}_screen.png"
    xml_path.write_text(driver.page_source, encoding="utf-8")
    driver.get_screenshot_as_file(str(png_path))
    return xml_path, png_path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default="config.json")
    args = parser.parse_args()

    config = load_config(args.config)
    remote_url = config["remote_url"]
    options = UiAutomator2Options().load_capabilities(config["capabilities"])
    probe = config.get("probe", {})
    output_dir = Path(probe.get("output_dir", "outputs"))
    wait_seconds = int(probe.get("wait_seconds", 8))
    keywords = probe.get("keywords", [])

    driver = None
    try:
        print(f"Connecting to Appium: {remote_url}")
        driver = webdriver.Remote(remote_url, options=options)
        time.sleep(wait_seconds)

        prefix = f"hello_local_probe_{timestamp()}"
        xml_path, png_path = save_artifacts(driver, output_dir, prefix)
        page_source = xml_path.read_text(encoding="utf-8")
        hits = [keyword for keyword in keywords if keyword in page_source]

        print(f"Saved page XML: {xml_path}")
        print(f"Saved screenshot: {png_path}")
        print(f"Keyword hits: {hits}")

        if hits:
            print("Probe result: app launched and UI text is readable.")
            return 0

        print("Probe result: app launched, but expected rental keywords were not readable.")
        return 2
    except WebDriverException as exc:
        print("Probe result: Appium connection or app launch failed.")
        print(str(exc))
        return 1
    finally:
        if driver is not None:
            driver.quit()


if __name__ == "__main__":
    raise SystemExit(main())
