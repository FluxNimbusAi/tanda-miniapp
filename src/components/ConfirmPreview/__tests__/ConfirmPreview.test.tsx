// @vitest-environment jsdom
// VISUAL-B golden tests (t_d3455bc6): the preview-before-sign gate must show
// the human verb, the decoded amount when present, and fire ONLY the confirm
// callback on sign (never cancel), so a userOp can never be built silently.
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmPreview } from "../index";

afterEach(cleanup);

const summary = {
  fn: "fundEscrow",
  amount: "12.500000",
  target: "0xd0cc3595679a36b64c860568217b623605980e6a",
};

describe("ConfirmPreview — preview-before-sign", () => {
  it("renders verb, tabular amount and shortened target", () => {
    render(
      <ConfirmPreview
        summary={summary}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByTestId("confirm-preview")).toBeInTheDocument();
    expect(
      screen.getByText("Park USDC into the bill's escrow"),
    ).toBeInTheDocument();
    expect(screen.getByText(/12\.500000 USDC/)).toBeInTheDocument();
    expect(screen.getByText(/contract 0xd0cc3595…980e6a/)).toBeInTheDocument();
  });

  it("confirm fires ONLY onConfirm; cancel fires ONLY onCancel", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmPreview
        summary={summary}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByTestId("confirm-sign"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("cancel-sign"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("undecodable amount hides the money line; unknown verb falls back to fn name", () => {
    render(
      <ConfirmPreview
        summary={{
          fn: "mysteryOp",
          target: "0x0000000000000000000000000000000000000000",
        }}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.queryByText(/USDC/)).not.toBeInTheDocument();
    expect(screen.getByText("Run mysteryOp on the bill")).toBeInTheDocument();
  });
});
