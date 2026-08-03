from pathlib import Path
from skillopt.envs.qaplatform.loader import QAPlatformLoader

CASES = str(Path(__file__).resolve().parents[1] / "skillopt" / "envs" / "qaplatform" / "cases")

def test_load_train_split():
    loader = QAPlatformLoader(split_dir=CASES, split_mode="split_dir")
    items = loader.load_split_items(CASES + "/train")
    assert len(items) == 3
    ids = {it["id"] for it in items}
    assert ids == {"t1", "t2", "t3"}
    assert all("caseType" in it and "mock" in it for it in items)
